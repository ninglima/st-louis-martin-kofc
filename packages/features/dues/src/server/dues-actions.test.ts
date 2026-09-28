import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';
const MEMBER_ID = '6f1c1b1e-1111-4111-8111-111111111111';
const PERIOD_ID = '6f1c1b1e-2222-4111-8111-111111111111';

/**
 * Same shape as `members-actions.test.ts`/`roster-actions.test.ts`:
 * `enhanceAction`'s own job (captcha, the auth redirect) is tested where it
 * lives, and stubbing it here keeps `server-only`, `next/headers` and GoTrue
 * out of a plain vitest run so these tests exercise the ACTION BODIES
 * against a fake `.rpc()` -- no live Supabase instance.
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

const {
  recordDuesPaymentAction,
  voidDuesPeriodAction,
  setAcceptedOnAction,
  setDuesLevelAction,
  setStudentAction,
} = await import('./dues-actions');

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** A fake Supabase client whose `.rpc()` resolves with the given error (or
 * succeeds with `error: null`) on every call, and records what was called. */
function fakeClient(options: { error?: { code?: string; message?: string } }) {
  const calls: RpcCall[] = [];

  return {
    calls,
    client: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });

        return Promise.resolve({
          data: null,
          error: options.error ?? null,
        });
      },
    },
  };
}

function useClient(options: Parameters<typeof fakeClient>[0] = {}) {
  const fake = fakeClient(options);

  h.officer = fake.client;

  return fake;
}

const validPayment = {
  memberId: MEMBER_ID,
  level: 'regular_contrib',
  method: 'cash' as const,
  receivedOn: '2026-09-01',
};

const validVoid = { periodId: PERIOD_ID, reason: 'duplicate entry' };
const validAcceptedOn = { memberId: MEMBER_ID, acceptedOn: '2026-09-01' };
const validLevel = { memberId: MEMBER_ID, level: 'regular_contrib' };
const validStudent = { memberId: MEMBER_ID, isStudent: true };

beforeEach(() => {
  h.officer = null;
  h.revalidated = [];
});

describe('error code mapping (toMessage, via recordDuesPaymentAction)', () => {
  it.each([
    ['42501', 'You do not have permission to manage dues.'],
    ['23P01', 'That would overlap an existing dues period.'],
    ['23514', 'A check number is required.'],
  ] as const)('maps Postgres code %s', async (code, expected) => {
    useClient({ error: { code } });

    const result = await recordDuesPaymentAction(validPayment);

    expect(result).toEqual({ success: false, error: expected });
  });

  it('maps P0001 to the exception message itself', async () => {
    useClient({
      error: { code: 'P0001', message: 'unknown dues level: bogus' },
    });

    const result = await recordDuesPaymentAction(validPayment);

    expect(result).toEqual({
      success: false,
      error: 'unknown dues level: bogus',
    });
  });

  it('falls back to a generic message when P0001 has no message', async () => {
    useClient({ error: { code: 'P0001' } });

    const result = await recordDuesPaymentAction(validPayment);

    expect(result).toEqual({
      success: false,
      error: 'The dues change was refused.',
    });
  });

  it('falls back to a generic message for an unmapped or missing code', async () => {
    useClient({ error: { code: '23505', message: 'duplicate key' } });

    const result = await recordDuesPaymentAction(validPayment);

    expect(result).toEqual({
      success: false,
      error: 'Something went wrong saving the dues change.',
    });

    useClient({ error: {} });

    const noCodeResult = await recordDuesPaymentAction(validPayment);

    expect(noCodeResult).toEqual({
      success: false,
      error: 'Something went wrong saving the dues change.',
    });
  });
});

describe('schema rejection', () => {
  it('recordDuesPaymentAction rejects invalid input without calling the RPC', async () => {
    const fake = useClient();

    const result = await recordDuesPaymentAction({
      ...validPayment,
      method: 'check',
      checkNumber: undefined,
    });

    expect(result.success).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('voidDuesPeriodAction rejects a blank reason without calling the RPC', async () => {
    const fake = useClient();

    const result = await voidDuesPeriodAction({
      periodId: PERIOD_ID,
      reason: '   ',
    });

    expect(result.success).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('setAcceptedOnAction rejects an invalid date without calling the RPC', async () => {
    const fake = useClient();

    const result = await setAcceptedOnAction({
      memberId: MEMBER_ID,
      acceptedOn: '2026-02-30',
    });

    expect(result).toEqual({ success: false, error: 'Enter a valid date' });
    expect(fake.calls).toEqual([]);
  });

  it('setDuesLevelAction rejects a missing level without calling the RPC', async () => {
    const fake = useClient();

    const result = await setDuesLevelAction({ memberId: MEMBER_ID, level: '' });

    expect(result).toEqual({ success: false, error: 'Choose a dues level' });
    expect(fake.calls).toEqual([]);
  });

  it('setStudentAction rejects a non-boolean isStudent without calling the RPC', async () => {
    const fake = useClient();

    const result = await setStudentAction({
      memberId: MEMBER_ID,
      isStudent: 'yes' as unknown as boolean,
    });

    expect(result).toEqual({ success: false, error: 'Invalid input' });
    expect(fake.calls).toEqual([]);
  });
});

describe('revalidatePath', () => {
  it('fires both paths on success', async () => {
    useClient();

    const result = await recordDuesPaymentAction(validPayment);

    expect(result).toEqual({ success: true });
    expect(h.revalidated).toEqual([
      '/home/members',
      ['/home/members/[id]', 'page'],
    ]);
  });

  it('does not fire on an RPC failure', async () => {
    useClient({ error: { code: '42501' } });

    const result = await recordDuesPaymentAction(validPayment);

    expect(result.success).toBe(false);
    expect(h.revalidated).toEqual([]);
  });

  it('does not fire on a schema rejection', async () => {
    useClient();

    const result = await voidDuesPeriodAction({
      periodId: PERIOD_ID,
      reason: '',
    });

    expect(result.success).toBe(false);
    expect(h.revalidated).toEqual([]);
  });

  it.each([
    ['voidDuesPeriodAction', () => voidDuesPeriodAction(validVoid)],
    ['setAcceptedOnAction', () => setAcceptedOnAction(validAcceptedOn)],
    ['setDuesLevelAction', () => setDuesLevelAction(validLevel)],
    ['setStudentAction', () => setStudentAction(validStudent)],
  ] as const)('%s fires both paths on success', async (_name, call) => {
    useClient();

    const result = await call();

    expect(result).toEqual({ success: true });
    expect(h.revalidated).toEqual([
      '/home/members',
      ['/home/members/[id]', 'page'],
    ]);
  });
});
