import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';
const MEMBER_ID_1 = '6f1c1b1e-1111-4111-8111-111111111111';
const MEMBER_ID_2 = '6f1c1b1e-2222-4111-8111-111111111111';

/**
 * Same shape as `dues-actions.test.ts`: `enhanceAction`'s own job is tested
 * where it lives, and stubbing it here keeps `server-only`, `next/headers`
 * and GoTrue out of a plain vitest run so these tests exercise the ACTION
 * BODIES against a fake client -- no live Supabase instance.
 *
 * `perms` defaults to holding both grants the actions require (I1):
 * `finance.manage` and `members.view`. Individual tests narrow it to prove
 * the guard actually bites.
 */
const h = vi.hoisted(() => ({
  revalidated: [] as (string | [string, string])[],
  officer: null as unknown,
  perms: {
    finance: { canView: true, canManage: true },
    members: { canView: true, canManage: false },
  } as Record<string, { canView: boolean; canManage: boolean }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (params: never, user: { id: string }) => unknown) => (params: never) =>
      fn(params, { id: USER_ID }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => {
    h.revalidated.push(type ? [path, type] : path);
  },
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => h.officer,
}));

// `canManagePaidThrough` loads permissions with the admin client (RLS on
// `role_permissions` would otherwise block a caller from reading their own
// grants) -- the identity of the client it's given doesn't matter here,
// only what `loadPermissionsForUser` is stubbed to return.
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({}),
}));

vi.mock('@kit/rbac/server/permissions.service', () => ({
  loadPermissionsForUser: () => Promise.resolve(h.perms),
}));

const { previewPaidThroughAction, applyPaidThroughAction } =
  await import('./paid-through-actions');

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface FakeLevel {
  slug: string;
  name: string;
  amount_cents: number;
  self_service: boolean;
}

/**
 * A fake Supabase client covering both calls the preview makes (`.from(
 * 'members')...in()`, chunked; `.from('dues_levels')...eq().order()`; and
 * the `member_dues_summary` RPC) and the one the apply makes
 * (`dues_opening_balances_apply`).
 */
function fakeClient(options: {
  members?: { id: string; membership_number: string }[];
  membersError?: { code?: string; message?: string };
  levels?: FakeLevel[];
  summaries?: {
    member_id: string;
    dues_level: string;
    level_name: string;
    amount_cents: number;
    accepted_on: string | null;
    is_student: boolean;
    paid_through: string | null;
    dues_status: string;
  }[];
  rpcError?: { code?: string; message?: string };
  applyResult?: {
    applied: number;
    skipped: { membership_number: string; reason: string }[];
  };
}) {
  const rpcCalls: RpcCall[] = [];
  const membershipNumberBatches: string[][] = [];

  return {
    rpcCalls,
    membershipNumberBatches,
    get membershipNumbersQueried() {
      return membershipNumberBatches.flat();
    },
    client: {
      from: (table: string) => {
        if (table === 'members') {
          return {
            select: () => ({
              in: (_column: string, values: string[]) => {
                membershipNumberBatches.push(values);

                if (options.membersError) {
                  return Promise.resolve({
                    data: null,
                    error: options.membersError,
                  });
                }

                const matched = (options.members ?? []).filter((m) =>
                  values.includes(m.membership_number),
                );

                return Promise.resolve({ data: matched, error: null });
              },
            }),
          };
        }

        if (table === 'dues_levels') {
          return {
            select: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({
                    data: options.levels ?? [],
                    error: null,
                  }),
              }),
            }),
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });

        if (name === 'member_dues_summary') {
          return Promise.resolve({
            data: options.summaries ?? [],
            error: null,
          });
        }

        if (name === 'dues_opening_balances_apply') {
          return Promise.resolve({
            data: options.rpcError
              ? null
              : (options.applyResult ?? { applied: 0, skipped: [] }),
            error: options.rpcError ?? null,
          });
        }

        throw new Error(`unexpected rpc ${name}`);
      },
    },
  };
}

function useClient(options: Parameters<typeof fakeClient>[0] = {}) {
  const fake = fakeClient(options);

  h.officer = fake.client;

  return fake;
}

/** Builds a valid CSV with `count` distinct, loadable rows. */
function csvWithRows(count: number): string {
  const lines = ['membership_number,paid_through'];

  for (let i = 0; i < count; i++) {
    lines.push(`${10_000 + i},2027-01-01`);
  }

  return lines.join('\n') + '\n';
}

const VALID_CSV =
  'membership_number,paid_through\n1001,2027-01-01\n1002,2027-06-01\n';

beforeEach(() => {
  h.officer = null;
  h.revalidated = [];
  h.perms = {
    finance: { canView: true, canManage: true },
    members: { canView: true, canManage: false },
  };
});

describe('permission gate (I1)', () => {
  it.each([
    [
      'no finance.manage',
      {
        finance: { canView: true, canManage: false },
        members: { canView: true, canManage: false },
      },
    ],
    [
      'no members.view',
      {
        finance: { canView: true, canManage: true },
        members: { canView: false, canManage: false },
      },
    ],
    ['no role at all', {}],
  ] as const)(
    'previewPaidThroughAction refuses with %s',
    async (_label, perms) => {
      const fake = useClient();
      h.perms = perms;

      const result = await previewPaidThroughAction(VALID_CSV);

      expect(result).toEqual({
        success: false,
        error: 'You do not have permission to manage dues.',
      });
      expect(fake.rpcCalls).toEqual([]);
      expect(fake.membershipNumberBatches).toEqual([]);
    },
  );

  it.each([
    [
      'no finance.manage',
      {
        finance: { canView: true, canManage: false },
        members: { canView: true, canManage: false },
      },
    ],
    [
      'no members.view',
      {
        finance: { canView: true, canManage: true },
        members: { canView: false, canManage: false },
      },
    ],
  ] as const)(
    'applyPaidThroughAction refuses with %s',
    async (_label, perms) => {
      const fake = useClient();
      h.perms = perms;

      const result = await applyPaidThroughAction([
        { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
      ]);

      expect(result).toEqual({
        success: false,
        error: 'You do not have permission to manage dues.',
      });
      expect(fake.rpcCalls).toEqual([]);
    },
  );

  it('both actions proceed once both grants are held', async () => {
    useClient({ applyResult: { applied: 1, skipped: [] } });

    const preview = await previewPaidThroughAction(VALID_CSV);
    expect(preview.success).toBe(true);

    const apply = await applyPaidThroughAction([
      { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
    ]);
    expect(apply.success).toBe(true);
  });
});

describe('previewPaidThroughAction', () => {
  it('rejects a non-string or blank payload without touching the client', async () => {
    const fake = useClient();

    const result = await previewPaidThroughAction('   ');

    expect(result).toEqual({
      success: false,
      error: 'Choose a CSV file to upload.',
    });
    expect(fake.rpcCalls).toEqual([]);
  });

  it('rejects a payload over 1 MB', async () => {
    const fake = useClient();

    const result = await previewPaidThroughAction('a'.repeat(1_000_001));

    expect(result).toEqual({
      success: false,
      error: 'That file is larger than 1 MB.',
    });
    expect(fake.rpcCalls).toEqual([]);
  });

  it('rejects a file with more than 5,000 rows before doing any lookup', async () => {
    const fake = useClient();

    const result = await previewPaidThroughAction(csvWithRows(5001));

    expect(result).toEqual({
      success: false,
      error: 'That file has more than 5,000 rows.',
    });
    expect(fake.membershipNumberBatches).toEqual([]);
  });

  it('parses the csv and reports unknown and already-recorded numbers', async () => {
    const fake = useClient({
      members: [{ id: MEMBER_ID_1, membership_number: '1001' }],
      summaries: [
        {
          member_id: MEMBER_ID_1,
          dues_level: 'regular',
          level_name: 'Regular',
          amount_cents: 5000,
          accepted_on: '2020-01-01',
          is_student: false,
          paid_through: '2026-01-01',
          dues_status: 'lapsed',
        },
      ],
    });

    const result = await previewPaidThroughAction(VALID_CSV);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.rows).toHaveLength(2);
    expect(result.unknownNumbers).toEqual(['1002']);
    expect(result.alreadyRecorded).toEqual(['1001']);
    expect(result.unknownLevels).toEqual([]);
    expect(fake.membershipNumbersQueried).toEqual(['1001', '1002']);
  });

  it('reports a dues_level that is not active as unknown (I4)', async () => {
    const csv =
      'membership_number,paid_through,dues_level\n' +
      '1001,2027-01-01,regular\n' +
      '1002,2027-01-01,stduent\n';

    const fake = useClient({
      members: [
        { id: MEMBER_ID_1, membership_number: '1001' },
        { id: MEMBER_ID_2, membership_number: '1002' },
      ],
      levels: [
        {
          slug: 'regular',
          name: 'Regular',
          amount_cents: 5000,
          self_service: true,
        },
      ],
      summaries: [],
    });

    const result = await previewPaidThroughAction(csv);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.unknownLevels).toEqual([
      { membershipNumber: '1002', level: 'stduent' },
    ]);
    expect(fake.rpcCalls.some((c) => c.name === 'member_dues_summary')).toBe(
      true,
    );
  });

  it('chunks the membership-number lookup in batches of 200 (I3)', async () => {
    const fake = useClient({ summaries: [] });

    const result = await previewPaidThroughAction(csvWithRows(250));

    expect(result.success).toBe(true);
    expect(fake.membershipNumberBatches).toHaveLength(2);
    expect(fake.membershipNumberBatches[0]).toHaveLength(200);
    expect(fake.membershipNumberBatches[1]).toHaveLength(50);
  });

  it('only asks member_dues_summary about members it found', async () => {
    const fake = useClient({
      members: [{ id: MEMBER_ID_2, membership_number: '1002' }],
      summaries: [],
    });

    await previewPaidThroughAction(VALID_CSV);

    const summaryCall = fake.rpcCalls.find(
      (call) => call.name === 'member_dues_summary',
    );

    expect(summaryCall?.args).toEqual({ p_member_ids: [MEMBER_ID_2] });
  });

  it('maps a 42501 lookup error to the permission message', async () => {
    useClient({ membersError: { code: '42501' } });

    const result = await previewPaidThroughAction(VALID_CSV);

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to manage dues.',
    });
  });

  it('maps an unknown lookup error code to the generic message (M5)', async () => {
    useClient({
      membersError: { code: '57014', message: 'canceling statement' },
    });

    const result = await previewPaidThroughAction(VALID_CSV);

    expect(result).toEqual({
      success: false,
      error: 'Something went wrong loading the paid-through dates.',
    });
  });
});

describe('applyPaidThroughAction', () => {
  const validRows = [
    { line: 2, membershipNumber: '1001', paidThrough: '2027-01-01' },
    {
      line: 3,
      membershipNumber: '1002',
      paidThrough: '2027-06-01',
      duesLevel: 'student',
    },
  ];

  it('rejects invalid input without calling the RPC', async () => {
    const fake = useClient();

    const result = await applyPaidThroughAction([{ membershipNumber: '' }]);

    expect(result.success).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('rejects more than 5,000 rows without calling the RPC', async () => {
    const fake = useClient();

    const rows = Array.from({ length: 5001 }, (_, i) => ({
      line: i + 2,
      membershipNumber: String(10_000 + i),
      paidThrough: '2027-01-01',
    }));

    const result = await applyPaidThroughAction(rows);

    expect(result.success).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('sends snake_case rows to dues_opening_balances_apply and returns the result', async () => {
    const fake = useClient({
      applyResult: {
        applied: 1,
        skipped: [{ membership_number: '1002', reason: 'unknown dues level' }],
      },
    });

    const result = await applyPaidThroughAction(validRows);

    expect(result).toEqual({
      success: true,
      applied: 1,
      skipped: [{ membership_number: '1002', reason: 'unknown dues level' }],
    });

    expect(fake.rpcCalls).toEqual([
      {
        name: 'dues_opening_balances_apply',
        args: {
          p_rows: [
            { membership_number: '1001', paid_through: '2027-01-01' },
            {
              membership_number: '1002',
              paid_through: '2027-06-01',
              dues_level: 'student',
            },
          ],
        },
      },
    ]);
  });

  it('fires both revalidatePath calls on success', async () => {
    useClient({ applyResult: { applied: 2, skipped: [] } });

    await applyPaidThroughAction(validRows);

    expect(h.revalidated).toEqual([
      '/home/members',
      ['/home/members/[id]', 'page'],
    ]);
  });

  it('does not revalidate on an RPC failure', async () => {
    useClient({
      rpcError: { code: 'P0001', message: 'p_rows must be a JSON array' },
    });

    const result = await applyPaidThroughAction(validRows);

    expect(result).toEqual({
      success: false,
      error: 'p_rows must be a JSON array',
    });
    expect(h.revalidated).toEqual([]);
  });

  it('maps 42501 to the permission message', async () => {
    useClient({ rpcError: { code: '42501' } });

    const result = await applyPaidThroughAction(validRows);

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to manage dues.',
    });
  });

  it('maps an unknown rpc error code to the generic message (M5)', async () => {
    useClient({ rpcError: { code: '57014', message: 'canceling statement' } });

    const result = await applyPaidThroughAction(validRows);

    expect(result).toEqual({
      success: false,
      error: 'Something went wrong loading the paid-through dates.',
    });
  });
});
