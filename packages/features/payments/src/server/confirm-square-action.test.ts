import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DuesLevel } from '@kit/dues/types';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';
const PAYMENT_ID = '0f4c2a8e-1b9d-4c3a-9e7f-2d5b6a8c9e01';

/**
 * Exercises `confirmSquarePaymentAction`'s ACTION BODY with the same
 * approach as `create-payment-action.test.ts`: `enhanceAction` calls
 * straight through, and the admin client, the provider and `DuesService`
 * are in-memory fakes. The point: a row that `refuseToCharge` rejects never
 * reaches the card charge, and is never claimed (left `pending`).
 */
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  charges: [] as Record<string, unknown>[],
  levels: [] as DuesLevel[],
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

vi.mock('@kit/rbac/types', () => ({ hasPermission: () => true }));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: h.row, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        h.updates.push(values);
        const chain = {
          eq: () => chain,
          select: async () => ({ data: [h.row], error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ kind: 'session' }),
}));

vi.mock('@kit/dues/server/dues.service', () => ({
  DuesService: class {
    levels = async () => h.levels;
  },
}));

vi.mock('../providers/provider-factory', () => ({
  getPaymentProvider: async () => ({
    chargeWithToken: async (params: Record<string, unknown>) => {
      h.charges.push(params);
      return { paymentId: 'sq_1', status: 'succeeded' };
    },
  }),
}));

vi.mock('../providers/square.provider', () => ({
  describeSquareChargeError: () => null,
  isDefiniteSquareChargeFailure: () => false,
}));

const { confirmSquarePaymentAction } = await import('./server-actions');

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    user_id: USER_ID,
    status: 'pending',
    amount: 2500,
    currency: 'usd',
    payment_type: 'donation',
    description: null,
    metadata: {},
    ...overrides,
  };
}

const confirm = () =>
  confirmSquarePaymentAction({ paymentId: PAYMENT_ID, sourceToken: 'cnon:ok' });

beforeEach(() => {
  h.row = payment();
  h.updates = [];
  h.charges = [];
  h.levels = [
    { slug: 'regular', name: 'Regular', amountCents: 5000, selfService: true },
  ];
});

describe('confirmSquarePaymentAction re-checks the row before charging', () => {
  it('charges a valid pending donation', async () => {
    await expect(confirm()).resolves.toEqual({
      success: true,
      status: 'succeeded',
    });
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]).toMatchObject({ amount: 2500 });
  });

  it('charges a dues row priced at its level', async () => {
    h.row = payment({
      payment_type: 'dues',
      amount: 5000,
      metadata: { dues_level: 'regular' },
    });

    await expect(confirm()).resolves.toMatchObject({ success: true });
    expect(h.charges[0]).toMatchObject({ amount: 5000 });
  });

  it.each([
    ['a 1-cent row inserted directly', payment({ amount: 1 })],
    ["another member's row", payment({ user_id: 'someone-else' })],
    ['a row that is no longer pending', payment({ status: 'failed' })],
    [
      'a dues row not priced at its level',
      payment({
        payment_type: 'dues',
        amount: 100,
        metadata: { dues_level: 'regular' },
      }),
    ],
  ])('refuses %s without charging or claiming it', async (_label, row) => {
    h.row = row;

    const result = await confirm();

    expect(result.success).toBe(false);
    expect(h.charges).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });
});
