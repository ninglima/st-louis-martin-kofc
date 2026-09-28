import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DUES_LEVEL_METADATA_KEY } from '@kit/dues/lib/payment-metadata';
import type { DuesLevel, MyDuesSummary } from '@kit/dues/types';

import type Stripe from 'stripe';

import { mapStripeWebhookEvent } from '../providers/stripe.provider';

const USER_ID = '6b5f6f1c-3d1a-4d5e-9d4b-1f2c3d4e5f60';
const PAYMENT_INTENT_ID = 'pi_contract_1';

/**
 * The cross-layer contract of the ONLINE dues money path, from the
 * TypeScript side (final review I3). The database side of the same contract
 * is `apps/portal/supabase/tests/dues_payment_contract.test.sql`, which
 * feeds `kit.record_online_dues_period` exactly the row pinned here.
 *
 * Unlike `create-payment-action.test.ts`, `PaymentService` is NOT mocked:
 * the assertion is on the literal row `createPaymentAction` asks the admin
 * client to insert into `public.payments`, which is what the trigger reads:
 *
 * - `metadata` has the level under the top-level `DUES_LEVEL_METADATA_KEY`
 *   (`'dues_level'`, the key the trigger reads);
 * - `amount` is the level price in integer cents (`dues_levels.amount_cents`),
 *   never dollars;
 * - `provider_payment_id` is the PaymentIntent id, the same id the Stripe
 *   webhook mapper hands `updatePaymentStatus` to find the row by.
 */
const h = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  levels: [] as DuesLevel[],
  mine: null as MyDuesSummary | null,
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
    from: (table: string) => ({
      // payment_config lookup
      select: () => ({
        single: async () => ({ data: { active_provider: 'stripe' } }),
      }),
      // PaymentService.createPayment
      insert: (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => ({
              data: { id: 'row-1', ...row },
              error: null,
            }),
          }),
        };
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
    mySummary = async () => h.mine;
  },
}));

vi.mock('../providers/provider-factory', () => ({
  getPaymentProvider: async () => ({
    createPayment: async () => ({
      paymentId: PAYMENT_INTENT_ID,
      clientSecret: 'secret',
      status: 'pending',
    }),
  }),
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
];

beforeEach(() => {
  h.inserts = [];
  h.levels = LEVELS;
  h.mine = {
    memberId: 'm1',
    duesLevel: 'regular_contrib',
    levelName: 'Regular (with voluntary contribution)',
    amountCents: 5800,
    acceptedOn: '2026-05-01',
    isStudent: false,
    paidThrough: null,
    duesStatus: 'due',
    levelSelfService: true,
    levelActive: true,
  };
});

describe('online dues payment contract (TypeScript side)', () => {
  it('names the metadata key the trigger reads', () => {
    // `kit.record_online_dues_period`: `v_pay.metadata ->> 'dues_level'`.
    expect(DUES_LEVEL_METADATA_KEY).toBe('dues_level');
  });

  it.each(LEVELS)(
    'inserts the $slug payment row the trigger expects',
    async (level) => {
      await createPaymentAction({ payment_type: 'dues', level: level.slug });

      expect(h.inserts).toHaveLength(1);
      expect(h.inserts[0]?.table).toBe('payments');
      expect(h.inserts[0]?.row).toEqual({
        user_id: USER_ID,
        provider: 'stripe',
        provider_payment_id: PAYMENT_INTENT_ID,
        amount: level.amountCents,
        currency: 'usd',
        status: 'pending',
        payment_type: 'dues',
        description: `Annual dues — ${level.name}`,
        metadata: { [DUES_LEVEL_METADATA_KEY]: level.slug },
      });
      expect(Number.isInteger(h.inserts[0]?.row.amount)).toBe(true);
    },
  );

  it('payment_intent.succeeded finds that row by the same PaymentIntent id', () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: {
        object: { id: PAYMENT_INTENT_ID, status: 'succeeded' },
      },
    } as unknown as Stripe.Event;

    expect(mapStripeWebhookEvent(event)).toMatchObject({
      providerPaymentId: PAYMENT_INTENT_ID,
      status: 'succeeded',
    });
  });

  it('a full charge.refunded finds that row through the charge payment_intent', () => {
    const event = {
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_contract_1',
          payment_intent: PAYMENT_INTENT_ID,
          refunded: true,
          amount: 5000,
          amount_refunded: 5000,
        },
      },
    } as unknown as Stripe.Event;

    expect(mapStripeWebhookEvent(event)).toMatchObject({
      providerPaymentId: PAYMENT_INTENT_ID,
      status: 'refunded',
    });
  });
});
