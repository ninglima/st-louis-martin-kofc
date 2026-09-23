import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeClient } from '../../test/fixtures/fake-supabase';
import type { RosterRecord } from '../types/roster';
import { RosterImportService } from './roster-import.service';
import type { PlanAction, PlanRow } from './roster-plan';

function record(overrides: Partial<RosterRecord> = {}): RosterRecord {
  return {
    membershipNumber: '1000001',
    prefix: null,
    firstName: 'Ada',
    middleName: null,
    lastName: 'Lovelace',
    suffix: null,
    primaryEmail: 'ada@example.com',
    emailSecondary: null,
    addressLine1: '1 Main St',
    addressLine2: null,
    city: 'Saint Louis',
    state: 'MO',
    postalCode: '63101',
    country: 'US',
    primaryType: 'Regular',
    phoneCell: '314-555-0100',
    phoneResidence: null,
    phoneBusiness: null,
    secondaryAddress: null,
    badAddress: false,
    sourceRow: 2,
    ...overrides,
  };
}

function row(
  action: PlanAction,
  overrides: Partial<RosterRecord> = {},
  plan: Pick<PlanRow, 'fillsPrimaryEmail'> = {},
): PlanRow {
  const r = record(overrides);

  return {
    membershipNumber: r.membershipNumber,
    displayName: `${r.firstName} ${r.lastName}`,
    sourceRow: r.sourceRow,
    action,
    conflicts: [],
    record: action === 'skip' ? undefined : r,
    ...plan,
  };
}

const ALREADY_REGISTERED = {
  error: {
    message: 'A user with this email address has already been registered',
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RosterImportService permission re-check', () => {
  it('creates no auth account when the grant has gone', async () => {
    // The upsert's own gate fires per ROW, which is after ensureAuthUser has
    // already made a real, durable, sign-in-capable account for a real member.
    // A grant revoked between the preview and chunk 4 would leave those
    // accounts behind for every remaining row and then report 42501 -- a
    // denied import that nevertheless created up to 372 auth users, which no
    // failed row rolls back and no re-run cleans up.
    const fake = fakeClient({ canManage: false });

    await expect(
      new RosterImportService(fake.client).applyChunk(
        [
          row('create', { membershipNumber: '1000001' }),
          row('create', { membershipNumber: '1000002' }),
        ],
        'roster.xlsx',
      ),
    ).rejects.toThrow(/insufficient_privilege/);

    expect(fake.createUserEmails).toEqual([]);
    expect(fake.listUsersPages).toEqual([]);
    expect(fake.rpcs).toEqual([]);
  });

  it('asks before it touches auth, not after', async () => {
    const fake = fakeClient();

    await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    expect(fake.order[0]).toBe('members_can_manage');
    expect(fake.order.indexOf('members_can_manage')).toBeLessThan(
      fake.order.indexOf('createUser'),
    );
  });

  it('re-asks on every chunk rather than trusting the upload', async () => {
    const fake = fakeClient();
    const service = new RosterImportService(fake.client);

    await service.applyChunk([row('create')], 'roster.xlsx');
    await service.applyChunk(
      [row('create', { membershipNumber: '1000002' })],
      'roster.xlsx',
    );

    expect(fake.canManageCalls).toBe(2);
  });

  it('asks even for a chunk that would write nothing', async () => {
    // A chunk of only skips and nochanges issues no RPC, so without the probe
    // an unauthorised caller gets a clean {applied: 0, failures: []} back as
    // though it had succeeded.
    const fake = fakeClient({ canManage: false });

    await expect(
      new RosterImportService(fake.client).applyChunk(
        [row('nochange'), row('skip', { membershipNumber: '1000002' })],
        'roster.xlsx',
      ),
    ).rejects.toThrow(/insufficient_privilege/);
  });

  it('refuses the chunk when the probe itself fails', async () => {
    // An unanswerable question is not a yes.
    const fake = fakeClient({ canManageError: { message: 'connection lost' } });

    await expect(
      new RosterImportService(fake.client).applyChunk(
        [row('create')],
        'roster.xlsx',
      ),
    ).rejects.toThrow('connection lost');

    expect(fake.createUserEmails).toEqual([]);
  });
});

describe('RosterImportService.applyChunk', () => {
  it('applies creates and updates and leaves skips and nochanges alone', async () => {
    const fake = fakeClient();
    const result = await new RosterImportService(fake.client).applyChunk(
      [
        row('create', { membershipNumber: '1000001' }),
        row('update', { membershipNumber: '1000002' }),
        row('nochange', { membershipNumber: '1000003' }),
        row('skip', { membershipNumber: '1000004' }),
      ],
      'roster.xlsx',
    );

    expect(result).toEqual({ applied: 2, failures: [] });
    expect(fake.rpcs.map((c) => c.name)).toEqual([
      'member_upsert_from_roster',
      'member_upsert_from_roster',
    ]);
    expect(
      fake.rpcs.map(
        (c) => (c.args.p as Record<string, unknown>).membership_number,
      ),
    ).toEqual(['1000001', '1000002']);
  });

  it('stamps the source file on every row it applies', async () => {
    const fake = fakeClient();

    await new RosterImportService(fake.client).applyChunk(
      [row('update')],
      'september.xlsx',
    );

    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).source_file).toBe(
      'september.xlsx',
    );
  });

  it('collects a failed row without costing the rest of the chunk', async () => {
    // The plan is persisted, so a reported failure is re-runnable. A thrown
    // one would abandon every row after it.
    const fake = fakeClient({
      rpcError: (_call, index) => (index === 0 ? { message: 'boom' } : null),
    });

    const result = await new RosterImportService(fake.client).applyChunk(
      [
        row('update', { membershipNumber: '1000001' }),
        row('update', { membershipNumber: '1000002' }),
      ],
      'roster.xlsx',
    );

    expect(result.applied).toBe(1);
    expect(result.failures).toEqual([
      { membershipNumber: '1000001', error: 'boom' },
    ]);
  });

  it('sends no dues, level, expiry or paid-through field', async () => {
    // Belt and braces with the RPC, which has no parameter for one: an import
    // must never be able to change dues state.
    const fake = fakeClient();

    await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    const payload = fake.rpcs[0]!.args.p as Record<string, unknown>;

    for (const key of Object.keys(payload))
      expect(key).not.toMatch(/dues|level|expir|paid.?through|status/i);
  });
});

describe('RosterImportService account linking', () => {
  it('creates the account silently and links the new id', async () => {
    // createUser sends no mail; inviteUserByEmail does. Inviting hundreds of
    // members is a separate, explicit decision.
    const fake = fakeClient({ createUser: [{ id: 'user-new' }] });

    await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    expect(fake.createUserEmails).toEqual(['ada@example.com']);
    expect(fake.inviteCalls).toEqual([]);
    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-new',
    );
  });

  it('resolves the existing id when the address is already registered', async () => {
    // Returning null here would write user_id = null, and the upsert's
    // coalesce(m.user_id, excluded.user_id) makes a null STICKY -- so the
    // members who already had accounts would be the ones permanently
    // unlinked, and no later import could repair it.
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED],
      authUsers: [
        { id: 'user-someone-else', email: 'other@example.com' },
        { id: 'user-existing', email: 'ada@example.com' },
      ],
    });

    const result = await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    expect(result).toEqual({ applied: 1, failures: [] });
    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-existing',
    );
  });

  it('matches the registered address case-insensitively', async () => {
    // Supabase lowercases what it stores; the file need not.
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED],
      authUsers: [{ id: 'user-existing', email: 'ada@example.com' }],
    });

    await new RosterImportService(fake.client).applyChunk(
      [row('create', { primaryEmail: 'Ada@Example.COM' })],
      'roster.xlsx',
    );

    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-existing',
    );
  });

  it('fails the row rather than writing a null when the owner cannot be found', async () => {
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED],
      authUsers: [],
    });

    const result = await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    expect(result.applied).toBe(0);
    expect(result.failures[0]!.membershipNumber).toBe('1000001');
    expect(result.failures[0]!.error).toMatch(/already registered/i);
    expect(fake.rpcs).toEqual([]);
  });

  it('reads the auth directory once however many addresses are taken', async () => {
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED, ALREADY_REGISTERED],
      authUsers: [
        { id: 'user-a', email: 'a@example.com' },
        { id: 'user-b', email: 'b@example.com' },
      ],
    });

    await new RosterImportService(fake.client).applyChunk(
      [
        row('create', {
          membershipNumber: '1000001',
          primaryEmail: 'a@example.com',
        }),
        row('create', {
          membershipNumber: '1000002',
          primaryEmail: 'b@example.com',
        }),
      ],
      'roster.xlsx',
    );

    // One sweep of the directory, not one per taken address. Without the
    // cache this would be [1, 2, 1, 2].
    expect(fake.listUsersPages.map((p) => p.page)).toEqual([1, 2]);
    expect(
      fake.rpcs.map((c) => (c.args.p as Record<string, unknown>).user_id),
    ).toEqual(['user-a', 'user-b']);
  });

  it('pages past the first page of the auth directory', async () => {
    // auth-js parses the response's `nextPage` one character wide, so it is
    // wrong from page 10 on; paging must not depend on it.
    const authUsers = Array.from({ length: 1_001 }, (_, i) => ({
      id: `user-${i}`,
      email: `member${i}@example.com`,
    }));

    const fake = fakeClient({ createUser: [ALREADY_REGISTERED], authUsers });

    await new RosterImportService(fake.client).applyChunk(
      [row('create', { primaryEmail: 'member1000@example.com' })],
      'roster.xlsx',
    );

    expect(fake.listUsersPages).toEqual([
      { page: 1, perPage: 1_000 },
      { page: 2, perPage: 1_000 },
    ]);
    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-1000',
    );
  });

  it('does not look up an account for an update row that fills no address', async () => {
    // The member already has an address on file, so there is nothing new to
    // attach an account to. user_id stays null and the upsert coalesces it, so
    // an already-linked member keeps their link.
    const fake = fakeClient();

    await new RosterImportService(fake.client).applyChunk(
      [row('update', {}, { fillsPrimaryEmail: false })],
      'roster.xlsx',
    );

    expect(fake.createUserEmails).toEqual([]);
    expect(fake.listUsersPages).toEqual([]);
    expect(
      (fake.rpcs[0]!.args.p as Record<string, unknown>).user_id,
    ).toBeNull();
  });

  it('creates an account for an update row that fills a blank address', async () => {
    // This is the ONLY path by which the members who never gave the council an
    // email become account holders. Before it they gained an address and
    // stayed permanently account-less, with nothing anywhere saying why.
    const fake = fakeClient({ createUser: [{ id: 'user-first-time' }] });

    const result = await new RosterImportService(fake.client).applyChunk(
      [row('update', {}, { fillsPrimaryEmail: true })],
      'roster.xlsx',
    );

    expect(result).toEqual({ applied: 1, failures: [] });
    expect(fake.createUserEmails).toEqual(['ada@example.com']);
    expect(fake.inviteCalls).toEqual([]);
    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-first-time',
    );
  });

  it('attaches no account to a filling row that carries no address at all', async () => {
    // Belt and braces: `fillsPrimaryEmail` cannot be true without an incoming
    // address, but the guard must not depend on the planner being right.
    const fake = fakeClient();

    await new RosterImportService(fake.client).applyChunk(
      [row('update', { primaryEmail: null }, { fillsPrimaryEmail: true })],
      'roster.xlsx',
    );

    expect(fake.createUserEmails).toEqual([]);
    expect(
      (fake.rpcs[0]!.args.p as Record<string, unknown>).user_id,
    ).toBeNull();
  });

  it('reports the database rejecting a second member on one account', async () => {
    // A member with no stored address who was given an account by hand is
    // invisible to the planner's owned-by-another-member guard, so a second
    // member carrying that address resolves the same id. `members_user_id_uk`
    // refuses it; the row is reported, the chunk carries on, and the two
    // members are NOT silently joined -- which would let either account read
    // the other's decrypted row through members_select_own.
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED, ALREADY_REGISTERED],
      authUsers: [{ id: 'user-shared', email: 'ada@example.com' }],
      rpcError: (_call, index) =>
        index === 1
          ? {
              message:
                'duplicate key value violates unique constraint "members_user_id_uk"',
            }
          : null,
    });

    const result = await new RosterImportService(fake.client).applyChunk(
      [
        row('create', { membershipNumber: '1000001' }),
        row('create', { membershipNumber: '1000002' }),
      ],
      'roster.xlsx',
    );

    expect(result.applied).toBe(1);
    expect(result.failures).toEqual([
      {
        membershipNumber: '1000002',
        error:
          'duplicate key value violates unique constraint "members_user_id_uk"',
      },
    ]);
  });

  it('pages on when the deployment returns fewer users than were asked for', async () => {
    // A page that comes back short only because the server caps perPage is not
    // the end of the directory. Stopping there would make a registered address
    // look unregistered -- the exact null this service exists to avoid.
    const authUsers = Array.from({ length: 120 }, (_, i) => ({
      id: `user-${i}`,
      email: `member${i}@example.com`,
    }));

    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED],
      authUsers,
      authPerPageCap: 50,
    });

    await new RosterImportService(fake.client).applyChunk(
      [row('create', { primaryEmail: 'member100@example.com' })],
      'roster.xlsx',
    );

    expect(fake.listUsersPages).toHaveLength(3);
    expect((fake.rpcs[0]!.args.p as Record<string, unknown>).user_id).toBe(
      'user-100',
    );
  });

  it('refuses to resolve an account against a directory that never ends', async () => {
    // Silently truncating at the page limit would resolve to null and, before
    // the not-found throw, would have written a sticky null.
    const fake = fakeClient({
      createUser: [ALREADY_REGISTERED],
      authAlwaysFull: true,
      authPerPageCap: 2,
    });

    const result = await new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    expect(result.applied).toBe(0);
    expect(result.failures[0]!.error).toMatch(/did not end within \d+ pages/);
    expect(fake.rpcs).toEqual([]);
  });

  it('backs off and retries a rate-limited creation', async () => {
    vi.useFakeTimers();

    const fake = fakeClient({
      createUser: [
        { error: { message: 'rate limit exceeded' } },
        { id: 'user-new' },
      ],
    });

    const applying = new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(await applying).toEqual({ applied: 1, failures: [] });
    expect(fake.createUserEmails).toHaveLength(2);
  });

  it('gives up and fails the row once the backoff is exhausted', async () => {
    vi.useFakeTimers();

    const fake = fakeClient({
      createUser: Array.from({ length: 4 }, () => ({
        error: { message: 'rate limit exceeded' },
      })),
    });

    const applying = new RosterImportService(fake.client).applyChunk(
      [row('create')],
      'roster.xlsx',
    );

    await vi.advanceTimersByTimeAsync(4_250);

    const result = await applying;

    expect(result.applied).toBe(0);
    expect(result.failures[0]!.error).toBe('rate limit exceeded');
    expect(fake.createUserEmails).toHaveLength(4);
    expect(fake.rpcs).toEqual([]);
  });
});
