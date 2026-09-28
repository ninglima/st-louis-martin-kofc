import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';
const MEMBER_ID_1 = '6f1c1b1e-1111-4111-8111-111111111111';
const MEMBER_ID_2 = '6f1c1b1e-2222-4111-8111-111111111111';

/**
 * Same shape as `dues-actions.test.ts`: `enhanceAction`'s own job is tested
 * where it lives, and stubbing it here keeps `server-only`, `next/headers`
 * and GoTrue out of a plain vitest run so these tests exercise the ACTION
 * BODIES against a fake client -- no live Supabase instance.
 */
const h = vi.hoisted(() => ({
  revalidated: [] as (string | [string, string])[],
  officer: null as unknown,
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

const { previewPaidThroughAction, applyPaidThroughAction } =
  await import('./paid-through-actions');

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A fake Supabase client covering both calls the preview makes (`.from(
 * 'members')...in()` and the `member_dues_summary` RPC) and the one the
 * apply makes (`dues_opening_balances_apply`).
 */
function fakeClient(options: {
  members?: { id: string; membership_number: string }[];
  membersError?: { code?: string; message?: string };
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
  let membershipNumbersQueried: string[] = [];

  return {
    rpcCalls,
    get membershipNumbersQueried() {
      return membershipNumbersQueried;
    },
    client: {
      from: (table: string) => {
        if (table !== 'members') throw new Error(`unexpected table ${table}`);

        return {
          select: () => ({
            in: (_column: string, values: string[]) => {
              membershipNumbersQueried = values;

              return Promise.resolve({
                data: options.membersError ? null : (options.members ?? []),
                error: options.membersError ?? null,
              });
            },
          }),
        };
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

const VALID_CSV =
  'membership_number,paid_through\n1001,2027-01-01\n1002,2027-06-01\n';

beforeEach(() => {
  h.officer = null;
  h.revalidated = [];
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
    expect(fake.membershipNumbersQueried).toEqual(['1001', '1002']);
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

  it('maps a lookup error to a generic message', async () => {
    useClient({ membersError: { code: '42501' } });

    const result = await previewPaidThroughAction(VALID_CSV);

    expect(result).toEqual({
      success: false,
      error: 'You do not have permission to manage dues.',
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
});
