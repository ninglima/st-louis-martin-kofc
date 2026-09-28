import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapStripeWebhookEvent } from './stripe.provider';

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: 'evt_1', type, data: { object } } as unknown as Stripe.Event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapStripeWebhookEvent', () => {
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
});
