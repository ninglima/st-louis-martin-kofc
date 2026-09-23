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

/** Every ordering of `items`. Used to prove verdicts are order-independent. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];

  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

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
    // The council knows neither number, so there is no basis on which to
    // prefer one row over the other and BOTH are skipped -- see the
    // order-independence test below for why picking the first is not safe.
    expect(plan.rows[1]?.reason).toBe('Two rows in the file share this email');
    expect(plan.rows[0]?.action).toBe('skip');
  });

  it('prefers the membership number the council already knows when two rows share an email', () => {
    const stored = [
      existing({
        membershipNumber: '1000004',
        primaryEmail: 'peter@example.com',
      }),
    ];
    const bogus = record({
      membershipNumber: '9999999',
      primaryEmail: 'peter@example.com',
      lastName: 'Bogus',
    });
    const real = record({
      membershipNumber: '1000004',
      primaryEmail: 'peter@example.com',
      lastName: 'Nolan',
      sourceRow: 3,
    });

    for (const rows of [
      [bogus, real],
      [real, bogus],
    ]) {
      const plan = buildPlan(rows, stored);
      const realRow = plan.rows.find((r) => r.membershipNumber === '1000004');
      const bogusRow = plan.rows.find((r) => r.membershipNumber === '9999999');

      expect(realRow?.action).not.toBe('skip');
      expect(bogusRow?.action).toBe('skip');
      expect(bogusRow?.reason).toBe('Duplicate email in file');
    }
  });

  it('skips both rows, in either order, when the council knows neither number', () => {
    // The go-live import runs against an EMPTY council, so the stored-owner
    // check has nothing to consult and pure spreadsheet order would otherwise
    // decide which member is real. A stale row for a transferred-out member
    // sorting above the current member's row would drop the current member
    // and create the impostor.
    const bogus = record({
      membershipNumber: '9999999',
      primaryEmail: 'peter@example.com',
      lastName: 'Bogus',
    });
    const real = record({
      membershipNumber: '1000004',
      primaryEmail: 'peter@example.com',
      lastName: 'Nolan',
      sourceRow: 3,
    });

    for (const rows of [
      [bogus, real],
      [real, bogus],
    ]) {
      const plan = buildPlan(rows, []);

      expect(plan.counts).toEqual({
        create: 0,
        update: 0,
        nochange: 0,
        skip: 2,
      });
      for (const row of plan.rows) {
        expect(row.reason).toBe('Two rows in the file share this email');
      }
    }
  });

  it('lets a member keep their own good row after an earlier row is skipped for its email', () => {
    // The earlier row was never planned, so it must not consume the
    // membership number. Reported as a duplicate of a row that does not exist,
    // the member vanishes AND the stated reason is false.
    const plan = buildPlan(
      [
        record({ membershipNumber: '1000001', primaryEmail: 'a@example.com' }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'a@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'b@example.com',
          city: 'Sterling',
          sourceRow: 4,
        }),
      ],
      [],
    );

    const good = plan.rows[2]!;

    expect(good.action).toBe('create');
    expect(good.reason).toBeUndefined();
    // Updated in round 5 (R26). The first row is 1000001's ONLY address, and
    // 1000002 gives two, so a@example.com is awarded to 1000001 rather than
    // skipped for both: sole-address beats multi-address. Previously both
    // rows for a@ were skipped and only 1000002's good row survived.
    expect(plan.rows[0]?.action).toBe('create');
    expect(plan.rows.filter((r) => r.action === 'skip')).toHaveLength(1);
  });

  it('still calls a repeated membership number a duplicate row, not a shared email', () => {
    // Same number AND same email is one member listed twice, which the
    // membership-number check owns. Only DIFFERENT numbers contest an email.
    const plan = buildPlan([record(), record({ sourceRow: 3 })], []);

    expect(plan.rows[0]?.action).toBe('create');
    expect(plan.rows[1]?.reason).toBe('Duplicate row in file');
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
      kind: 'value-differs',
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
    // One skip of each reason: a repeated membership number, and two rows
    // contesting an email that the council cannot adjudicate.
    const plan = buildPlan(
      [
        record(),
        record({ sourceRow: 3 }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'shared@example.com',
          sourceRow: 4,
        }),
        record({
          membershipNumber: '1000003',
          primaryEmail: 'shared@example.com',
          sourceRow: 5,
        }),
      ],
      [],
    );

    for (const row of plan.rows) {
      if (row.action === 'skip') expect(row.record).toBeUndefined();
    }

    expect(plan.counts.skip).toBe(3);
    expect(new Set(plan.rows.map((r) => r.reason))).toEqual(
      new Set([
        undefined,
        'Duplicate row in file',
        'Two rows in the file share this email',
      ]),
    );
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
          primaryEmail: 'e@example.com',
          sourceRow: 5,
        }),
        record({
          membershipNumber: '1000006',
          primaryEmail: 'e@example.com',
          sourceRow: 6,
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
      skip: 3,
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
      kind: 'owned-by-another-member',
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

    // Against a council that already knows the real member, the impostor row
    // is the one skipped and the real one survives.
    const known = buildPlan(records, [
      existing({
        membershipNumber: '1000004',
        primaryEmail: 'peter@example.com',
      }),
    ]);

    expect(
      known.rows.find((r) => r.membershipNumber === '1000007')?.action,
    ).toBe('skip');
    expect(
      known.rows.find((r) => r.membershipNumber === '1000007')?.reason,
    ).toBe('Duplicate email in file');
    expect(
      known.rows.find((r) => r.membershipNumber === '1000004')?.action,
    ).not.toBe('skip');

    // Against an empty council there is no basis to prefer either, so both go.
    const blind = buildPlan(records, []);

    for (const number of ['1000004', '1000007']) {
      const row = blind.rows.find((r) => r.membershipNumber === number);

      expect(row?.action).toBe('skip');
      expect(row?.reason).toBe('Two rows in the file share this email');
    }
  });

  it('plans the whole fixture against an empty council', async () => {
    const plan = buildPlan(await fixtureRecords(), []);

    // 11 fixture rows; the parser drops 3 (no email, blank number, malformed
    // email), leaving 8 planned. 5 creates and 3 skips: the repeated
    // membership number, plus BOTH rows sharing peter@example.com -- on an
    // empty council nothing distinguishes the real member from the impostor,
    // and creating the wrong one is worse than creating neither.
    expect(plan.rows).toHaveLength(8);
    expect(plan.counts).toEqual({
      create: 5,
      update: 0,
      nochange: 0,
      skip: 3,
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
    expect(plan.counts.skip).toBe(2);
    expect(plan.absentFromFile).toEqual([]);

    // A third pass over the same inputs must be identical, not merely small:
    // a planner that converged on the second run and drifted on the third
    // would still pass the assertion above.
    expect(buildPlan(records, stored).counts).toEqual(plan.counts);
  });

  it('does not let a doomed duplicate-number row contest an innocent email', () => {
    // The third row is a second listing of 1000001 carrying a typo of
    // 1000002's address. It will be discarded as a duplicate number whatever
    // happens, so it must not get a vote -- 1000002 has only one row and
    // would otherwise lose their go-live create to somebody else's typo.
    const plan = buildPlan(
      [
        record({ membershipNumber: '1000001', primaryEmail: 'a@example.com' }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'b@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '1000001',
          primaryEmail: 'b@example.com',
          sourceRow: 4,
        }),
      ],
      [],
    );

    expect(plan.rows.map((r) => [r.membershipNumber, r.action])).toEqual([
      ['1000001', 'create'],
      ['1000002', 'create'],
      ['1000001', 'skip'],
    ]);
    expect(plan.rows[2]?.reason).toBe('Duplicate row in file');
  });

  it('reaches the same verdict under every ordering of the same file', () => {
    // Re-grounded in round 5 (R28). This used to assert that moving the
    // innocent row changed nobody's fate -- true of these three rows, false
    // in general, so it was certifying luck rather than a property. Under
    // R26 the verdict is computed from sets, so EVERY ordering agrees, and
    // that is what is asserted now: all six permutations, not the two that
    // happened to work.
    const rows = [
      record({ membershipNumber: '1000001', primaryEmail: 'a@example.com' }),
      record({
        membershipNumber: '1000002',
        primaryEmail: 'b@example.com',
        sourceRow: 3,
      }),
      record({
        membershipNumber: '1000001',
        primaryEmail: 'b@example.com',
        sourceRow: 4,
      }),
    ];
    const verdicts = permutations(rows).map((order) =>
      buildPlan(order, [])
        .rows.filter((r) => r.action !== 'skip')
        .map((r) => `${r.membershipNumber}=${r.record?.primaryEmail}`)
        .sort()
        .join(' '),
    );

    expect(verdicts).toHaveLength(6);
    expect(new Set(verdicts).size).toBe(1);
    // Both members are created, and 1000001 keeps the address it claims once
    // rather than the one it contests with 1000002.
    expect(verdicts[0]).toBe('1000001=a@example.com 1000002=b@example.com');
  });

  it('never lets a twice-listed member take a sole-listed member’s address', () => {
    // Round 5, the scenario that broke the previous rule. 2000001 is listed
    // twice under two addresses, each shared with a member who lists only
    // that one. Under first-wins, 2000001 was created holding 2000003's
    // address -- and at go-live that address is the auth identity, so the
    // wrong person would own the account. 2000003's was their only row.
    const shared = record({
      membershipNumber: '2000001',
      primaryEmail: 's@example.com',
    });
    const soleS = record({
      membershipNumber: '2000002',
      primaryEmail: 's@example.com',
      sourceRow: 3,
    });
    const other = record({
      membershipNumber: '2000001',
      primaryEmail: 'o@example.com',
      sourceRow: 4,
    });
    const soleO = record({
      membershipNumber: '2000003',
      primaryEmail: 'o@example.com',
      sourceRow: 5,
    });

    for (const rows of [
      [shared, soleS, other, soleO],
      [soleO, other, soleS, shared],
      [other, soleO, shared, soleS],
    ]) {
      const plan = buildPlan(rows, []);
      const planned = plan.rows.filter((r) => r.action !== 'skip');

      expect(
        planned
          .map((r) => `${r.membershipNumber}=${r.record?.primaryEmail}`)
          .sort(),
      ).toEqual(['2000002=s@example.com', '2000003=o@example.com']);
      expect(
        plan.rows
          .filter((r) => r.membershipNumber === '2000001')
          .every((r) => r.action === 'skip'),
      ).toBe(true);
    }
  });

  it('lets the council’s own record outrank a sole-address claimant', () => {
    // Rule (a) beats rule (b). The council knows 2000001 owns this address;
    // 2000007 claims it and claims nothing else, so sole-address alone would
    // hand it to 2000007. What the roster already holds outranks what the
    // file asserts.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '2000001',
          primaryEmail: 'known@example.com',
        }),
        record({
          membershipNumber: '2000001',
          primaryEmail: 'second@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '2000007',
          primaryEmail: 'known@example.com',
          sourceRow: 4,
        }),
      ],
      [
        existing({
          membershipNumber: '2000001',
          primaryEmail: 'known@example.com',
        }),
      ],
    );

    expect(plan.rows[0]?.action).not.toBe('skip');
    expect(plan.rows[2]?.action).toBe('skip');
    expect(plan.rows[2]?.reason).toBe('Duplicate email in file');
  });

  it('skips everyone when no claimant gives only that address', () => {
    // Rule (c), the "or none is" half. Both members are listed twice under
    // the same two addresses, so neither is making a coherent claim and
    // there is nothing to prefer.
    const plan = buildPlan(
      [
        record({ membershipNumber: '3000001', primaryEmail: 'x@example.com' }),
        record({
          membershipNumber: '3000001',
          primaryEmail: 'y@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '3000002',
          primaryEmail: 'x@example.com',
          sourceRow: 4,
        }),
        record({
          membershipNumber: '3000002',
          primaryEmail: 'y@example.com',
          sourceRow: 5,
        }),
      ],
      [],
    );

    expect(plan.counts).toEqual({
      create: 0,
      update: 0,
      nochange: 0,
      skip: 4,
    });
    expect(plan.rows[0]?.reason).toBe('Two rows in the file share this email');
  });

  it('still skips both when a genuine contested pair each give only that address', () => {
    // Rule (c), the "two or more sole-address claimants" half. The rule must
    // not be weakened into uselessness: two DIFFERENT members, one row each,
    // sharing an address is still unadjudicable.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '1000001',
          primaryEmail: 'same@example.com',
        }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'same@example.com',
          sourceRow: 3,
        }),
      ],
      [],
    );

    expect(plan.counts).toEqual({
      create: 0,
      update: 0,
      nochange: 0,
      skip: 2,
    });
    for (const row of plan.rows) {
      expect(row.reason).toBe('Two rows in the file share this email');
    }
  });

  it('awards a contested email to the claimant giving only that address', () => {
    // Updated in round 5 (R26). 1000002 claims two addresses and 1000001 and
    // 1000003 claim one each, so both single-address members are created and
    // the two-address member gets neither. Before R26 the winner was decided
    // by file order, and 1000002 walked off with 1000003's address -- whose
    // only row it was, and which at go-live is their auth identity.
    const plan = buildPlan(
      [
        record({ membershipNumber: '1000001', primaryEmail: 'a@example.com' }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'a@example.com',
          sourceRow: 3,
        }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'b@example.com',
          sourceRow: 4,
        }),
        record({
          membershipNumber: '1000003',
          primaryEmail: 'b@example.com',
          sourceRow: 5,
        }),
      ],
      [],
    );

    expect(plan.rows.map((r) => [r.membershipNumber, r.action])).toEqual([
      ['1000001', 'create'],
      ['1000002', 'skip'],
      ['1000002', 'skip'],
      ['1000003', 'create'],
    ]);
  });

  it('never plans two rows holding the same email, under any row order', () => {
    // The structural invariant, and the reason the old first-wins backstop
    // could be removed rather than patched: when an address is claimed by two
    // numbers it is contested, and at most one number can pass the gate.
    // Checked exhaustively over every ordering of a file built to tangle --
    // two shared addresses, one member listed twice -- against both an empty
    // and a populated council.
    const rows = [
      record({ membershipNumber: '2000001', primaryEmail: 's@example.com' }),
      record({
        membershipNumber: '2000002',
        primaryEmail: 's@example.com',
        sourceRow: 3,
      }),
      record({
        membershipNumber: '2000001',
        primaryEmail: 'o@example.com',
        sourceRow: 4,
      }),
      record({
        membershipNumber: '2000003',
        primaryEmail: 'o@example.com',
        sourceRow: 5,
      }),
      record({
        membershipNumber: '2000004',
        primaryEmail: 'alone@example.com',
        sourceRow: 6,
      }),
      record({
        membershipNumber: '2000005',
        primaryEmail: 'o@example.com',
        sourceRow: 7,
      }),
    ];
    const councils = [
      [],
      [
        existing({
          membershipNumber: '2000003',
          primaryEmail: 'o@example.com',
        }),
      ],
    ];
    const plannedNumbers = new Map<string, string>();

    let checked = 0;

    for (const council of councils) {
      for (const order of permutations(rows)) {
        const plan = buildPlan(order, council);
        const planned = plan.rows.filter((r) => r.action !== 'skip');
        const emails = planned.map((r) => r.record?.primaryEmail);

        // No two planned rows hold the same address, ever.
        expect(new Set(emails).size).toBe(emails.length);

        // And WHICH members are planned does not depend on row order: the
        // whole point of R26. Recorded once per council, compared thereafter.
        const key = String(councils.indexOf(council));
        const fate = [...new Set(planned.map((r) => r.membershipNumber))]
          .sort()
          .join(',');

        if (!plannedNumbers.has(key)) plannedNumbers.set(key, fate);

        expect(fate).toBe(plannedNumbers.get(key));
        checked++;
      }
    }

    expect(checked).toBe(1440);
  });

  it('treats a whitespace-only stored email as blank, not as a disagreement', () => {
    // Both halves matter: the fill must fire AND no conflict may be emitted.
    // Reporting a member as disagreeing with '   ' while simultaneously
    // filling it is a contradiction the officer cannot act on.
    const plan = buildPlan(
      [record({ primaryEmail: 'john@example.com' })],
      [existing({ primaryEmail: '   ', filledFields: ALL_FILLED })],
    );

    expect(plan.rows[0]?.action).toBe('update');
    expect(
      plan.rows[0]?.conflicts.filter((c) => c.field === 'primaryEmail'),
    ).toEqual([]);
  });

  // --- Every row says where in the file it came from ---

  it('carries the source row of the record behind a create, update and nochange', () => {
    const plan = buildPlan(
      [
        record({ membershipNumber: '1000001', sourceRow: 12 }),
        record({
          membershipNumber: '1000002',
          primaryEmail: 'two@example.com',
          sourceRow: 34,
        }),
        record({
          membershipNumber: '1000003',
          primaryEmail: 'three@example.com',
          sourceRow: 56,
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
          filledFields: ALL_FILLED,
        }),
      ],
    );

    expect(plan.rows.map((r) => [r.action, r.sourceRow])).toEqual([
      ['create', 12],
      ['update', 34],
      ['nochange', 56],
    ]);
  });

  it('points a duplicate-number skip at the duplicate row, not the first occurrence', () => {
    // The officer has to delete the offending row. Sending them to the row
    // that was kept would have them remove the member's good data.
    const plan = buildPlan(
      [record({ sourceRow: 4 }), record({ sourceRow: 19 })],
      [],
    );

    expect(plan.rows[0]?.sourceRow).toBe(4);
    expect(plan.rows[1]?.action).toBe('skip');
    expect(plan.rows[1]?.sourceRow).toBe(19);
  });

  it('gives both contested-email skips their own row number', () => {
    // Neither row is adjudicable, so the officer must look at both -- and
    // cannot, if they share one row number or carry none.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '9999999',
          primaryEmail: 'peter@example.com',
          sourceRow: 7,
        }),
        record({
          membershipNumber: '1000004',
          primaryEmail: 'peter@example.com',
          sourceRow: 250,
        }),
      ],
      [],
    );

    expect(plan.rows.every((r) => r.action === 'skip')).toBe(true);
    expect(plan.rows.map((r) => r.sourceRow)).toEqual([7, 250]);
  });

  it('pins the fixture rows to the row numbers Excel actually shows', async () => {
    // A sourceRow that is present but wrong is worse than one that is absent:
    // it sends the officer to an innocent member's row. Pinned to literal
    // numbers against the real fixture rather than asserted to be defined.
    const records = await fixtureRecords();
    const plan = buildPlan(records, []);
    const at = (n: string) =>
      plan.rows.filter((r) => r.membershipNumber === n).map((r) => r.sourceRow);

    // Header is row 1, so the first data row is 2. Peter Nolan is the 4th
    // data row and the row repeating his email is the 8th; the row repeating
    // membership number 1000001 is the 7th.
    expect(at('1000004')).toEqual([5]);
    expect(at('1000007')).toEqual([9]);
    expect(at('1000001')).toEqual([2, 8]);

    const duplicateNumber = plan.rows.find(
      (r) => r.displayName === 'Duplicate Number',
    );

    expect(duplicateNumber?.reason).toBe('Duplicate row in file');
    expect(duplicateNumber?.sourceRow).toBe(8);
    // And it agrees with what the parser recorded, so the two cannot drift.
    expect(
      records.filter((r) => r.membershipNumber === '1000001')[1]?.sourceRow,
    ).toBe(8);
  });

  // --- A blank stored email is a fill, not a silent no-change ---

  it('plans a blank stored email with an incoming one as an update', () => {
    // Rule 3 governs a CHANGED email. Nothing has changed here -- there is
    // simply nothing on file -- so rule 1 owns it. Left out of the decision
    // the row lands in `nochange`, which the apply step skips, so the member
    // could never acquire an address and nothing anywhere would say so.
    const plan = buildPlan(
      [record({ primaryEmail: 'john@example.com' })],
      [existing({ primaryEmail: null, filledFields: ALL_FILLED })],
    );

    expect(plan.rows[0]?.action).toBe('update');
  });

  it('does not fill a blank stored email with an address another member holds', () => {
    // Filling a blank with somebody else's address is exactly the merge the
    // collision check exists to prevent, so this must stay out of the write
    // decision -- but be reported, not silent.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '1000002',
          primaryEmail: 'taken@example.com',
        }),
      ],
      [
        existing({
          membershipNumber: '1000002',
          primaryEmail: null,
          filledFields: ALL_FILLED,
        }),
        existing({
          membershipNumber: '1000001',
          primaryEmail: 'taken@example.com',
        }),
      ],
    );

    expect(plan.rows[0]?.action).toBe('nochange');
    expect(
      plan.rows[0]?.conflicts.some((c) => c.kind === 'owned-by-another-member'),
    ).toBe(true);
  });

  // --- Conflicts carry a machine-readable kind ---

  it('labels an already-populated field differently from a real disagreement', () => {
    // A zero-write re-import of the real roster emits thousands of
    // `already-set` entries. If the preview cannot separate them from the
    // handful of genuine disagreements by anything but string-matching a
    // sentence in this file, the genuine ones get scrolled past.
    const plan = buildPlan(
      [record({ lastName: 'Smythe' })],
      [existing({ lastName: 'Smith', filledFields: ALL_FILLED })],
    );

    const conflicts = plan.rows[0]!.conflicts;
    const byKind = (kind: string) => conflicts.filter((c) => c.kind === kind);

    expect(byKind('value-differs')).toEqual([
      {
        field: 'lastName',
        kind: 'value-differs',
        incoming: 'Smythe',
        stored: 'Smith',
      },
    ]);
    expect(byKind('already-set')).toHaveLength(ALL_FILLED.length);
    expect(
      byKind('already-set').every((c) => c.stored === '(already set)'),
    ).toBe(true);
  });

  it('keeps both primaryEmail conflicts distinguishable when a row has each kind', () => {
    // One row can legitimately carry two conflicts on the same field with
    // different meanings: the stored value differs, AND the incoming address
    // is somebody else's. Keyed by field name alone they collapse.
    const plan = buildPlan(
      [
        record({
          membershipNumber: '1000002',
          primaryEmail: 'taken@example.com',
        }),
      ],
      [
        existing({
          membershipNumber: '1000002',
          primaryEmail: 'old@example.com',
        }),
        existing({
          membershipNumber: '1000001',
          primaryEmail: 'taken@example.com',
        }),
      ],
    );

    const emailConflicts = plan.rows[0]!.conflicts.filter(
      (c) => c.field === 'primaryEmail',
    );

    expect(emailConflicts).toHaveLength(2);
    expect(emailConflicts.map((c) => c.kind).sort()).toEqual([
      'owned-by-another-member',
      'value-differs',
    ]);
    // Same field, same incoming value, different `stored` semantics -- which
    // is precisely why the kind has to carry the distinction.
    expect(new Set(emailConflicts.map((c) => c.stored)).size).toBe(2);
  });

  it('gives every conflict a kind', () => {
    const plan = buildPlan(
      [record({ lastName: 'Smythe' })],
      [existing({ lastName: 'Smith', filledFields: ALL_FILLED })],
    );
    const kinds = new Set(
      plan.rows.flatMap((r) => r.conflicts.map((c) => c.kind)),
    );

    expect(kinds.size).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect([
        'already-set',
        'value-differs',
        'owned-by-another-member',
      ]).toContain(kind);
    }
  });
});
