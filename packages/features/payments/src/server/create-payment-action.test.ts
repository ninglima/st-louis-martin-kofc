import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DuesLevel, MemberDuesSummary } from '@kit/dues/types';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';

/**
 * Exercises the ACTION BODY of `createPaymentAction` only. Same approach as
 * `@kit/dues`' `dues-actions.test.ts`: `enhanceAction` is stubbed to call
 * straight through, and every collaborator that would reach Supabase,
 * Stripe or Square is replaced with an in-memory fake that records what it
 * was given.
 */
const h = vi.hoisted(() => ({
  canCheckout: true,
  levels: [] as DuesLevel[],
  mine: null as MemberDuesSummary | null,
  providerCalls: [] as Record<string, unknown>[],
  rowCalls: [] as Record<string, unknown>[],
  duesClient: null as unknown,
  serverClient: { kind: 'session' },
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (fn: (params: never, user: { id: string }) => unknown) => (params: never) =>
      fn(params, { id: USER_ID }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

vi.mock('@kit/rbac/server/permissions.service', () => ({
  loadPermissionsForUser: async () => ({}),
}));

vi.mock('@kit/rbac/types', () => ({
  hasPermission: () => h.canCheckout,
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => ({
      select: () => ({
        single: async () => ({ data: { active_provider: 'stripe' } }),
      }),
    }),
  }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => h.serverClient,
}));

vi.mock('@kit/dues/server/dues.service', () => ({
  DuesService: class {
    constructor(client: unknown) {
      h.duesClient = client;
    }

    levels = async () => h.levels;
    mySummary = async () => h.mine;
  },
}));

vi.mock('../providers/provider-factory', () => ({
  getPaymentProvider: async () => ({
    createPayment: async (params: Record<string, unknown>) => {
      h.providerCalls.push(params);
      return {
        paymentId: 'pi_test',
        clientSecret: 'secret',
        status: 'pending',
      };
    },
  }),
}));

vi.mock('../providers/square.provider', () => ({
  describeSquareChargeError: () => null,
  isDefiniteSquareChargeFailure: () => false,
}));

vi.mock('./payment.service', () => ({
  PaymentService: class {
    createPayment = async (params: Record<string, unknown>) => {
      h.rowCalls.push(params);
      return { id: 'row-1' };
    };
  },
}));

const { createPaymentAction } = await import('./server-actions');

const LEVELS: DuesLevel[] = [
  {
    slug: 'regular_contrib',
    name: 'Regular (with voluntary contribution)',
    amountCents: 5800,
    selfService: true,
  },
  { slug: 'regular', name: 'Regular', amountCents: 5000, selfService: true },
  { slug: 'student', name: 'Student', amountCents: 2500, selfService: false },
  {
    slug: 'public_service',
    name: 'Public Service',
    amountCents: 2000,
    selfService: false,
  },
  { slug: 'honorary', name: 'Honorary', amountCents: 1900, selfService: false },
];

function member(overrides: Partial<MemberDuesSummary> = {}): MemberDuesSummary {
  return {
    memberId: 'm1',
    duesLevel: 'regular_contrib',
    levelName: 'Regular (with voluntary contribution)',
    amountCents: 5800,
    acceptedOn: null,
    isStudent: false,
    paidThrough: null,
    duesStatus: 'no_record',
    ...overrides,
  };
}

beforeEach(() => {
  h.canCheckout = true;
  h.levels = LEVELS;
  h.mine = member();
  h.providerCalls = [];
  h.rowCalls = [];
  h.duesClient = null;
});

describe('createPaymentAction: dues', () => {
  it('prices a forged dues POST from the level, ignoring the amount', async () => {
    await createPaymentAction({
      payment_type: 'dues',
      level: 'regular',
      amount: 1,
      currency: 'eur',
    });

    for (const call of [h.providerCalls[0], h.rowCalls[0]]) {
      expect(call).toMatchObject({
        payment_type: 'dues',
        amount: 5000,
        currency: 'usd',
        description: 'Annual dues — Regular',
        metadata: { dues_level: 'regular' },
        userId: USER_ID,
      });
    }
  });

  it('reads levels and the summary with the member session, not the admin client', async () => {
    await createPaymentAction({ payment_type: 'dues', level: 'regular' });

    expect(h.duesClient).toBe(h.serverClient);
  });

  it('never lets client metadata override the server-chosen level', async () => {
    await createPaymentAction({
      payment_type: 'dues',
      level: 'regular',
      metadata: { dues_level: 'honorary', note: 'kept' },
    });

    expect(h.rowCalls[0]?.metadata).toEqual({
      note: 'kept',
      dues_level: 'regular',
    });
    expect(h.providerCalls[0]?.metadata).toEqual({
      note: 'kept',
      dues_level: 'regular',
    });
  });

  it('refuses a sign-in with no member record', async () => {
    h.mine = null;

    await expect(
      createPaymentAction({ payment_type: 'dues', level: 'regular' }),
    ).rejects.toThrow(/not linked to a council member record/);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.rowCalls).toHaveLength(0);
  });

  it.each([
    ['an unknown level', 'platinum', member()],
    ['student when not a student', 'student', member()],
    ['a non-self-service level not assigned', 'honorary', member()],
    [
      'a self-service level when the FS assigned public_service',
      'regular',
      member({ duesLevel: 'public_service' }),
    ],
  ])('refuses %s', async (_label, level, mine) => {
    h.mine = mine;

    await expect(
      createPaymentAction({ payment_type: 'dues', level }),
    ).rejects.toThrow('That dues level is not available for your membership.');
    expect(h.providerCalls).toHaveLength(0);
    expect(h.rowCalls).toHaveLength(0);
  });

  it.each([
    ['student for a student', 'student', member({ isStudent: true }), 2500],
    [
      'the FS-assigned honorary level',
      'honorary',
      member({ duesLevel: 'honorary' }),
      1900,
    ],
  ])('accepts %s at its price', async (_label, level, mine, amount) => {
    h.mine = mine;

    await createPaymentAction({ payment_type: 'dues', level });

    expect(h.rowCalls[0]).toMatchObject({
      amount,
      metadata: { dues_level: level },
    });
  });

  it('refuses without the checkout permission', async () => {
    h.canCheckout = false;

    await expect(
      createPaymentAction({ payment_type: 'dues', level: 'regular' }),
    ).rejects.toThrow('You do not have permission to make a payment.');
  });
});

describe('createPaymentAction: donations', () => {
  it('keeps the client amount and does not consult dues', async () => {
    await createPaymentAction({
      payment_type: 'donation',
      amount: 2500,
      currency: 'usd',
      description: 'Building fund',
    });

    expect(h.duesClient).toBeNull();
    expect(h.rowCalls[0]).toMatchObject({
      payment_type: 'donation',
      amount: 2500,
      currency: 'usd',
      description: 'Building fund',
    });
  });

  it('rejects a donation with no amount', async () => {
    await expect(
      createPaymentAction({ payment_type: 'donation', currency: 'usd' }),
    ).rejects.toThrow();
  });
});
