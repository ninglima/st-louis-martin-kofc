import { describe, expect, it } from 'vitest';

import { buildFixtureWorkbook } from '../../test/fixtures/make-fixture';
import type { RosterRecord } from '../types/roster';
import { buildPlan, FILLABLE, type ExistingMember } from './roster-plan';
import { parseRoster } from './roster-parser';
import { readRoster } from './roster-reader';

/**
 * The field names Task 7's `existingForPlanning()` reports in
 * `ExistingMember.filledFields`, transcribed from its `mark()` calls. If these
 * and `FILLABLE` ever disagree, fill-blanks-only silently stops working for
 * the mismatched field: the planner asks `filled.has('phoneCell')` about a set
 * that only ever contains `phone_cell`, gets false, and proposes a write over
 * a value the member typed themselves.
 */
const FILLED_FIELD_NAMES = [
  'prefix',
  'middleName',
  'suffix',
  'city',
  'state',
  'country',
  'primaryType',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'phoneCell',
  'phoneResidence',
  'phoneBusiness',
  'emailSecondary',
  'secondaryAddress',
];

const DUES_SHAPED = /dues|level|expir|paid.?through/i;

/** Every key name in the object graph, at any depth. Values are ignored. */
function collectKeyNames(
  value: unknown,
  into = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyNames(item, into);

    return into;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeyNames(child, into);
    }
  }

  return into;
}

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    membershipNumber: '1000001',
    prefix: null,
    firstName: 'John',
    middleName: null,
    lastName: 'Smith',
    suffix: null,
    primaryEmail: 'john@example.com',
    emailSecondary: null,
    addressLine1: '1 Oak St',
    addressLine2: null,
    city: 'Ashburn',
    state: 'VA',
    postalCode: '20147',
    country: 'US',
    primaryType: 'Member',
    phoneCell: '(703) 555-0002',
    phoneResidence: null,
    phoneBusiness: null,
    secondaryAddress: null,
    badAddress: false,
    sourceRow: 2,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingMember> = {}): ExistingMember {
  return {
    membershipNumber: '1000001',
    primaryEmail: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    badAddress: false,
    filledFields: [],
    ...overrides,
  };
}

/** A member with every incoming contact field already stored. */
const ALL_FILLED = [
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'country',
  'primaryType',
  'phoneCell',
];

/** The shared fixture, read and parsed exactly as an upload would be. */
async function fixtureRecords(): Promise<RosterRecord[]> {
  const buffer = Buffer.from(await buildFixtureWorkbook().xlsx.writeBuffer());

  return parseRoster(await readRoster(buffer, 'roster.xlsx')).records;
}

describe('buildPlan', () => {
  it('classifies an unknown member as create', () => {
    const plan = buildPlan([record()], []);

    expect(plan.rows[0]?.action).toBe('create');
    expect(plan.counts.create).toBe(1);
  });

  it('classifies a known member with blanks to fill as update', () => {
    const plan = buildPlan([record()], [existing({ filledFields: ['city'] })]);

    expect(plan.rows[0]?.action).toBe('update');
  });

  it('is a no-op when every incoming field is already filled', () => {
    // This is the property that makes a monthly re-import safe.
    const plan = buildPlan(
      [record()],
      [
        existing({
          filledFields: [
            'addressLine1',
            'city',
            'state',
            'postalCode',
            'country',
            'primaryType',
            'phoneCell',
          ],
        }),
      ],
    );

    expect(plan.rows[0]?.action).toBe('nochange');
    expect(plan.counts.create).toBe(0);
  });

  it('skips a membership number that appears twice in the file', () => {
    const plan = buildPlan([record(), record({ sourceRow: 3 })], []);

    expect(plan.rows[1]?.action).toBe('skip');
    expect(plan.rows[1]?.reason).toBe('Duplicate row in file');
  });

  it('skips an email that appears twice in the file', () => {
    const plan = buildPlan(
      [record(), record({ membershipNumber: '1000002', sourceRow: 3 })],
      [],
    );

    expect(plan.rows[1]?.action).toBe('skip');
    expect(plan.rows[1]?.reason).toBe('Duplicate email in file');
  });

  it('skips an email that belongs to a different member number', () => {
    const plan = buildPlan(
      [record({ membershipNumber: '1000002' })],
      [
        existing({
          membershipNumber: '1000001',
          primaryEmail: 'john@example.com',
        }),
      ],
    );

    expect(plan.rows[0]?.action).toBe('skip');
    expect(plan.rows[0]?.reason).toBe(
      'That email already belongs to member 1000001',
    );
  });

  // --- The two rules the WordPress build got wrong ---

  it('reports a changed email as a conflict and never auto-applies it', () => {
    const plan = buildPlan(
      [record({ primaryEmail: 'new.address@example.com' })],
      [
        existing({
          primaryEmail: 'old.address@example.com',
          filledFields: ['addressLine1'],
        }),
      ],
    );

    const row = plan.rows[0]!;

    expect(row.action).not.toBe('skip');
    expect(row.conflicts).toContainEqual({
      field: 'primaryEmail',
      incoming: 'new.address@example.com',
      stored: 'old.address@example.com',
    });
  });

  it('never proposes writing a field that already holds a different value', () => {
    // Fill-blanks-only: a member's own correction must survive the import.
    const plan = buildPlan(
      [record({ city: 'Sterling' })],
      [existing({ filledFields: ['city'] })],
    );

    const row = plan.rows[0]!;

    expect(row.conflicts.some((c) => c.field === 'city')).toBe(true);
    expect(row.action).not.toBe('create');
  });

  it('emits no dues, level or expiry field anywhere in the plan', () => {
    // An import must never change dues state. If a future edit adds a dues
    // field to RosterRecord, this test fails and forces the conversation.
    //
    // Asserted over KEY NAMES only, never over serialized values: a member
    // living in Cleveland, or surnamed Leveque, spells "level", and a dues
    // test that fires on a place name is a test nobody will trust. The one
    // value-shaped thing checked here is `conflict.field`, whose contents are
    // field names by contract rather than member data.
    const plan = buildPlan(
      [
        // create
        record({
          membershipNumber: '1000001',
          city: 'Cleveland',
          lastName: 'Leveque',
        }),
        // update, with one conflict
        record({
          membershipNumber: '1000002',
          primaryEmail: 'two@example.com',
          sourceRow: 3,
        }),
        // nochange, with every incoming field conflicting
        record({
          membershipNumber: '1000003',
          primaryEmail: 'three@example.com',
          sourceRow: 4,
        }),
        // skip
        record({
          membershipNumber: '1000003',
          primaryEmail: 'four@example.com',
          sourceRow: 5,
        }),
      ],
      [
        existing({
          membershipNumber: '1000002',
          primaryEmail: 'two@example.com',
          filledFields: ['city'],
        }),
        existing({
          membershipNumber: '1000003',
          primaryEmail: 'three@example.com',
          filledFields: [
            'addressLine1',
            'city',
            'state',
            'postalCode',
            'country',
            'primaryType',
            'phoneCell',
          ],
        }),
      ],
    );

    const names = [
      ...collectKeyNames(plan),
      ...plan.rows.flatMap((row) => row.conflicts.map((c) => c.field)),
    ];

    for (const name of names) {
      expect(name).not.toMatch(DUES_SHAPED);
    }

    // Guard the guard: the walk must reach the nested record and conflict
    // objects, or it would pass vacuously on any plan at all.
    expect(names).toContain('membershipNumber');
    expect(names).toContain('postalCode');
    expect(names).toContain('conflicts');
    expect(names).toContain('city');
    expect(plan.counts).toEqual({
      create: 1,
      update: 1,
      nochange: 1,
      skip: 1,
    });
  });

  it('does not fail the dues rule on member data that merely spells one of its words', () => {
    // A direct regression on the defect in the original form of the test
    // above: it serialized the whole plan and grepped for 'level', so a
    // member from Cleveland failed an assertion about dues. Values are member
    // data; only field names are the invariant.
    const plan = buildPlan(
      [record({ city: 'Cleveland', lastName: 'Leveque' })],
      [],
    );

    expect(JSON.stringify(plan).toLowerCase()).toContain('level');
    expect([...collectKeyNames(plan)].some((k) => DUES_SHAPED.test(k))).toBe(
      false,
    );
  });

  it('fills exactly the field names the members service reports as filled', () => {
    // The two lists are matched by string equality at runtime and by nothing
    // at compile time, so this is the only thing standing between a rename
    // and a silently disabled safety rule.
    expect([...FILLABLE].sort()).toEqual([...FILLED_FIELD_NAMES].sort());
  });

  it('lists stored members absent from the file without proposing any change', () => {
    const plan = buildPlan(
      [record({ membershipNumber: '1000001' })],
      [
        existing({ membershipNumber: '1000001' }),
        existing({
          membershipNumber: '2000002',
          primaryEmail: 'absent@example.com',
        }),
      ],
    );

    expect(plan.absentFromFile).toEqual(['2000002']);
    expect(plan.rows.some((r) => r.membershipNumber === '2000002')).toBe(false);
  });

  // --- Additions beyond the brief ---

  it('carries no record on a skipped row, so a skip cannot be applied', () => {
    // An apply loop reads `row.record`. A skip that still carried one would
    // be written by any caller filtering on anything other than the action.
    const plan = buildPlan(
      [
        record(),
        record({ sourceRow: 3 }),
        record({ membershipNumber: '1000002', sourceRow: 4 }),
      ],
      [],
    );

    for (const row of plan.rows) {
      if (row.action === 'skip') expect(row.record).toBeUndefined();
    }

    expect(plan.counts.skip).toBe(2);
  });

  it('counts every row exactly once', () => {
    const plan = buildPlan(
      [
        record({ membershipNumber: '1000001', primaryEmail: 'a@example.com' }),
        record({
          membershipNumber: '1000003',
          primaryEmail: 'c@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '1000003',
          primaryEmail: 'd@example.com',
          sourceRow: 4,
        }),
        record({
          membershipNumber: '1000005',
          primaryEmail: 'a@example.com',
          sourceRow: 5,
        }),
      ],
      [
        existing({
          membershipNumber: '1000003',
          primaryEmail: 'c@example.com',
          filledFields: ['city'],
        }),
        existing({
          membershipNumber: '9999999',
          primaryEmail: 'z@example.com',
        }),
      ],
    );

    const total =
      plan.counts.create +
      plan.counts.update +
      plan.counts.nochange +
      plan.counts.skip;

    expect(total).toBe(plan.rows.length);
    expect(plan.counts).toEqual({
      create: 1,
      update: 1,
      nochange: 0,
      skip: 2,
    });
    expect(plan.absentFromFile).toEqual(['9999999']);
  });

  it('treats a stored email that differs only by case as the same address', () => {
    // Supabase auth lowercases and so does the parser, but a row written by
    // any other path may not have. Without this the member is reported as
    // having changed their email every single month, and is read as somebody
    // else's email owner.
    const plan = buildPlan(
      [record({ primaryEmail: 'john@example.com' })],
      [existing({ primaryEmail: 'John@Example.COM' })],
    );

    expect(plan.rows[0]?.action).not.toBe('skip');
    expect(
      plan.rows[0]?.conflicts.some((c) => c.field === 'primaryEmail'),
    ).toBe(false);
  });

  it('plans a newly flagged bad address as an update, not a no-change', () => {
    // The flag is the council's signal that a member's mail bounces, and the
    // apply step skips `nochange` rows entirely. A member whose contact
    // fields are all already stored -- the steady state a monthly re-import
    // produces -- would otherwise never carry the new flag to the database.
    const plan = buildPlan(
      [record({ badAddress: true })],
      [existing({ badAddress: false, filledFields: ALL_FILLED })],
    );

    expect(plan.rows[0]?.action).toBe('update');
    // Authoritative, not contested: the file always wins, so this is work to
    // do rather than something for the officer to reconcile.
    expect(plan.rows[0]?.conflicts.some((c) => c.field === 'badAddress')).toBe(
      false,
    );
  });

  it('plans a cleared bad address as an update too', () => {
    // A flag coming off means the member's mail works again. Treating only
    // the false -> true direction as work would leave every corrected address
    // flagged forever.
    const plan = buildPlan(
      [record({ badAddress: false })],
      [existing({ badAddress: true, filledFields: ALL_FILLED })],
    );

    expect(plan.rows[0]?.action).toBe('update');
  });

  it('leaves an unchanged bad address as a no-change', () => {
    // The flag must not turn every re-import into a write. Asserted with the
    // flag SET on both sides, which is the case the false/false default in
    // the no-op test above cannot reach.
    const plan = buildPlan(
      [record({ badAddress: true })],
      [existing({ badAddress: true, filledFields: ALL_FILLED })],
    );

    expect(plan.rows[0]?.action).toBe('nochange');
  });

  it('reports an email held by another member as a conflict when the number is known', () => {
    // The skip above only fires for an UNKNOWN membership number. When the
    // number is known the row is still an update, so without this the
    // collision appears nowhere in the preview -- the same shape of silence
    // as the WordPress email defect.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '1000002',
          primaryEmail: 'taken@example.com',
        }),
      ],
      [
        existing({ membershipNumber: '1000002', primaryEmail: null }),
        existing({
          membershipNumber: '1000001',
          primaryEmail: 'taken@example.com',
        }),
      ],
    );

    const row = plan.rows[0]!;

    expect(row.action).not.toBe('create');
    expect(row.conflicts).toContainEqual({
      field: 'primaryEmail',
      incoming: 'taken@example.com',
      stored: '(already belongs to member 1000001)',
    });
  });

  // --- Against the shared fixture, which carries both duplicate shapes ---

  it('skips the fixture row repeating a membership number under its own email', async () => {
    const records = await fixtureRecords();
    const repeated = records.filter((r) => r.membershipNumber === '1000001');

    // The fixture's duplicate-number row carries a UNIQUE email, so a planner
    // deduplicating only on email would let this one straight through.
    expect(repeated).toHaveLength(2);
    expect(repeated[1]?.primaryEmail).toBe('dup.number@example.com');

    const plan = buildPlan(records, []);
    const row = plan.rows.find((r) => r.displayName === 'Duplicate Number');

    expect(row?.action).toBe('skip');
    expect(row?.reason).toBe('Duplicate row in file');
  });

  it("skips the fixture row repeating another row's email under a new number", async () => {
    const records = await fixtureRecords();
    const repeated = records.find((r) => r.membershipNumber === '1000007');

    // Mirror image of the row above: a NEW membership number, so number
    // deduplication alone would let this one through.
    expect(repeated?.primaryEmail).toBe('peter@example.com');
    expect(
      records.find((r) => r.membershipNumber === '1000004')?.primaryEmail,
    ).toBe('peter@example.com');

    const plan = buildPlan(records, []);
    const row = plan.rows.find((r) => r.membershipNumber === '1000007');

    expect(row?.action).toBe('skip');
    expect(row?.reason).toBe('Duplicate email in file');
  });

  it('plans the whole fixture against an empty council', async () => {
    const plan = buildPlan(await fixtureRecords(), []);

    // 11 fixture rows; the parser drops 3 (no email, blank number, malformed
    // email), leaving 8 planned: 6 creates and the 2 duplicates.
    expect(plan.rows).toHaveLength(8);
    expect(plan.counts).toEqual({
      create: 6,
      update: 0,
      nochange: 0,
      skip: 2,
    });
    expect(plan.absentFromFile).toEqual([]);
  });

  it('plans the same fixture a second time as no change at all', async () => {
    // The monthly re-import property, end to end. This is the one the
    // WordPress build failed: every member already present, every incoming
    // field already filled, so nothing whatsoever should be written.
    const records = await fixtureRecords();
    const stored: ExistingMember[] = records
      .filter(
        (r, i) =>
          records.findIndex(
            (other) => other.membershipNumber === r.membershipNumber,
          ) === i,
      )
      .map((r) => ({
        membershipNumber: r.membershipNumber,
        primaryEmail: r.primaryEmail,
        firstName: r.firstName,
        lastName: r.lastName,
        // Stored exactly as last month's import left it, flag included --
        // including the fixture's genuinely flagged member 1000004.
        badAddress: r.badAddress,
        filledFields: [...FILLED_FIELD_NAMES],
      }));

    const plan = buildPlan(records, stored);

    expect(plan.counts.create).toBe(0);
    expect(plan.counts.update).toBe(0);
    expect(plan.counts.nochange).toBe(6);
    expect(plan.absentFromFile).toEqual([]);
  });
});
