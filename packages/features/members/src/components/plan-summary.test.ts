import { describe, expect, it } from 'vitest';

import type { ImportPlan, PlanRow } from '../server/roster-plan';
import type { RosterRecord } from '../types/roster';
import { summarizePlan } from './plan-summary';

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    membershipNumber: '1',
    prefix: null,
    firstName: 'Tom',
    middleName: null,
    lastName: 'Keen',
    suffix: null,
    primaryEmail: 'tom@example.com',
    emailSecondary: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    primaryType: null,
    phoneCell: null,
    phoneResidence: null,
    phoneBusiness: null,
    secondaryAddress: null,
    badAddress: false,
    sourceRow: 2,
    ...overrides,
  };
}

function plan(rows: PlanRow[]): ImportPlan {
  const counts = { create: 0, update: 0, nochange: 0, skip: 0 };

  for (const row of rows) counts[row.action]++;

  return { rows, counts, absentFromFile: [] };
}

describe('summarizePlan', () => {
  it('groups conflicts by kind rather than by field', () => {
    const summary = summarizePlan(
      plan([
        {
          membershipNumber: '1',
          displayName: 'Tom Keen',
          sourceRow: 2,
          action: 'create',
          conflicts: [
            {
              field: 'primaryEmail',
              kind: 'awarded-contested-email',
              incoming: 'tom@example.com',
              stored: '(also claimed in this file by member 9)',
            },
          ],
          record: record(),
        },
        {
          membershipNumber: '2',
          displayName: 'Ray Dell',
          sourceRow: 3,
          action: 'update',
          conflicts: [
            {
              field: 'primaryEmail',
              kind: 'owned-by-another-member',
              incoming: 'ray@example.com',
              stored: '(already belongs to member 7)',
            },
            {
              // Same FIELD as the line above and the opposite meaning: one is
              // a decision, one is silence. Only the kind separates them.
              field: 'primaryEmail',
              kind: 'already-set',
              incoming: 'ray@example.com',
              stored: '(already set)',
            },
            {
              field: 'lastName',
              kind: 'value-differs',
              incoming: 'Dell',
              stored: 'Dellow',
            },
          ],
          record: record({ membershipNumber: '2' }),
        },
      ]),
    );

    expect(summary.awarded).toHaveLength(1);
    expect(summary.awarded[0]!.row.membershipNumber).toBe('1');

    expect(
      summary.attention.map((entry) => entry.conflict.kind).sort(),
    ).toEqual(['owned-by-another-member', 'value-differs']);

    expect(summary.alreadySet).toHaveLength(1);
  });

  it('reports only members that no row imports as blocked', () => {
    const summary = summarizePlan(
      plan([
        {
          membershipNumber: '1',
          displayName: 'Tom Keen',
          sourceRow: 2,
          action: 'create',
          conflicts: [],
          record: record(),
        },
        {
          // The same member listed twice. Their own row above imports them,
          // so nobody needs to go and fix the spreadsheet for this.
          membershipNumber: '1',
          displayName: 'Tom Keen',
          sourceRow: 3,
          action: 'skip',
          reason: 'Duplicate row in file',
          conflicts: [],
        },
        {
          membershipNumber: '5',
          displayName: 'Ann Pratt',
          sourceRow: 8,
          action: 'skip',
          reason: 'Two rows in the file share this email',
          conflicts: [],
        },
        {
          membershipNumber: '5',
          displayName: 'Ann Pratt',
          sourceRow: 9,
          action: 'skip',
          reason: 'Two rows in the file share this email',
          conflicts: [],
        },
      ]),
    );

    expect(summary.skips).toHaveLength(3);
    expect(summary.blocked).toHaveLength(1);

    const blocked = summary.blocked[0]!;

    expect(blocked.membershipNumber).toBe('5');
    // Both row numbers, because the officer has to find both in the file.
    expect(blocked.rows.map((row) => row.sourceRow)).toEqual([8, 9]);
  });

  it('counts the rows that hand a member a way to sign in', () => {
    const summary = summarizePlan(
      plan([
        {
          membershipNumber: '1',
          displayName: 'Tom Keen',
          action: 'create',
          conflicts: [],
          record: record(),
        },
        {
          // A create with no address gets a member record and no account.
          membershipNumber: '2',
          displayName: 'No Mail',
          action: 'create',
          conflicts: [],
          record: record({ membershipNumber: '2', primaryEmail: null }),
        },
        {
          membershipNumber: '3',
          displayName: 'Fill Me',
          action: 'update',
          fillsPrimaryEmail: true,
          conflicts: [],
          record: record({ membershipNumber: '3' }),
        },
        {
          membershipNumber: '4',
          displayName: 'Just Phones',
          action: 'update',
          fillsPrimaryEmail: false,
          conflicts: [],
          record: record({ membershipNumber: '4' }),
        },
      ]),
    );

    expect(summary.newAccounts).toBe(2);
    expect(summary.writableRows).toBe(4);
  });
});
