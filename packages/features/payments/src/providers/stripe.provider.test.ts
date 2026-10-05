import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StripeProvider, mapStripeWebhookEvent } from './stripe.provider';

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: 'evt_1', type, data: { object } } as unknown as Stripe.Event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapStripeWebhookEvent', () => {
  it('records a failed payment (a bounced ACH debit, a declined card) as failed', () => {
    expect(
      mapStripeWebhookEvent(
        event('payment_intent.payment_failed', {
          id: 'pi_1',
          status: 'requires_payment_method',
        }),
      ),
    ).toEqual({
      type: 'payment_intent.payment_failed',
      providerPaymentId: 'pi_1',
      status: 'failed',
    });
  });

  it('keeps an ACH payment that is still clearing as processing', () => {
    expect(
      mapStripeWebhookEvent(
        event('payment_intent.processing', {
          id: 'pi_1',
          status: 'processing',
        }),
      ),
    ).toMatchObject({ status: 'processing' });
  });

  it('maps payment_intent events from the intent status (unchanged)', () => {
    expect(
      mapStripeWebhookEvent(
        event('payment_intent.succeeded', { id: 'pi_1', status: 'succeeded' }),
      ),
    ).toEqual({
      type: 'payment_intent.succeeded',
      providerPaymentId: 'pi_1',
      status: 'succeeded',
    });

    expect(
      mapStripeWebhookEvent(
        event('payment_intent.canceled', { id: 'pi_1', status: 'canceled' }),
      ),
    ).toMatchObject({ providerPaymentId: 'pi_1', status: 'cancelled' });
  });

  it('maps a full charge.refunded to refunded, keyed by the payment intent', () => {
    expect(
      mapStripeWebhookEvent(
        event('charge.refunded', {
          id: 'ch_1',
          object: 'charge',
          payment_intent: 'pi_1',
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
          status: 'succeeded',
        }),
      ),
    ).toEqual({
      type: 'charge.refunded',
      providerPaymentId: 'pi_1',
      status: 'refunded',
    });
  });

  it('accepts an expanded payment_intent object', () => {
    expect(
      mapStripeWebhookEvent(
        event('charge.refunded', {
          id: 'ch_1',
          payment_intent: { id: 'pi_2' },
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
        }),
      ),
    ).toMatchObject({ providerPaymentId: 'pi_2', status: 'refunded' });
  });

  it('ignores (and logs) a partial refund', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      mapStripeWebhookEvent(
        event('charge.refunded', {
          id: 'ch_1',
          payment_intent: 'pi_1',
          amount: 5000,
          amount_refunded: 1000,
          refunded: false,
        }),
      ),
    ).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it('ignores a refunded charge with no payment intent', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      mapStripeWebhookEvent(
        event('charge.refunded', {
          id: 'ch_1',
          payment_intent: null,
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
        }),
      ),
    ).toBeNull();
  });

  it('ignores events it does not handle', () => {
    expect(
      mapStripeWebhookEvent(
        event('charge.succeeded', { id: 'ch_1', status: 'succeeded' }),
      ),
    ).toBeNull();
  });

  it.each([
    ['charge.refund.updated', 'failed'],
    ['charge.refund.updated', 'canceled'],
    ['refund.failed', 'failed'],
    ['refund.updated', 'canceled'],
  ])(
    'logs a %s refund that is %s at error level, without changing status',
    (type, status) => {
      const log = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(
        mapStripeWebhookEvent(
          event(type, {
            id: 're_1',
            object: 'refund',
            status,
            amount: 5000,
            charge: 'ch_1',
            payment_intent: 'pi_1',
          }),
        ),
      ).toBeNull();
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/reconcile/i),
        expect.objectContaining({ paymentIntentId: 'pi_1', refundId: 're_1' }),
      );
    },
  );

  it('ignores a refund update that has not failed', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      mapStripeWebhookEvent(
        event('charge.refund.updated', {
          id: 're_1',
          status: 'succeeded',
          payment_intent: 'pi_1',
        }),
      ),
    ).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('StripeProvider.createPayment', () => {
  it('offers card and US bank account (ACH) only, so no Link or wallets', async () => {
    const provider = new StripeProvider('sk_test_fake', 'whsec_fake');
    const create = vi.fn(async (params: Record<string, unknown>) => ({
      id: 'pi_1',
      client_secret: 'secret',
      status: 'requires_payment_method',
      params,
    }));

    (
      provider as unknown as {
        stripe: { paymentIntents: { create: typeof create } };
      }
    ).stripe = { paymentIntents: { create } };

    await provider.createPayment({
      payment_type: 'dues',
      amount: 5000,
      currency: 'usd',
      userId: 'u1',
    });

    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(params.payment_method_types).toEqual(['card', 'us_bank_account']);
    expect(params.payment_method_options).toEqual({
      us_bank_account: { verification_method: 'automatic' },
    });
    expect(params).not.toHaveProperty('automatic_payment_methods');
  });

  it('never lets client metadata override userId or paymentType', async () => {
    const provider = new StripeProvider('sk_test_fake', 'whsec_fake');
    const create = vi.fn(async (params: Record<string, unknown>) => ({
      id: 'pi_1',
      client_secret: 'secret',
      status: 'requires_payment_method',
      params,
    }));

    (
      provider as unknown as {
        stripe: { paymentIntents: { create: typeof create } };
      }
    ).stripe = { paymentIntents: { create } };

    await provider.createPayment({
      payment_type: 'dues',
      amount: 5000,
      currency: 'usd',
      userId: 'real-user',
      metadata: {
        userId: 'evil',
        paymentType: 'donation',
        dues_level: 'regular',
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      amount: 5000,
      metadata: {
        userId: 'real-user',
        paymentType: 'dues',
        dues_level: 'regular',
      },
    });
  });
});
