import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mapSquareWebhookEvent,
  type SquareWebhookPayload,
} from './square.provider';

type Payment = NonNullable<
  NonNullable<NonNullable<SquareWebhookPayload['data']>['object']>['payment']
>;
type Refund = NonNullable<
  NonNullable<NonNullable<SquareWebhookPayload['data']>['object']>['refund']
>;

afterEach(() => {
  vi.restoreAllMocks();
});

function paymentEvent(payment: Payment): SquareWebhookPayload {
  return { type: 'payment.updated', data: { object: { payment } } };
}

function refundEvent(type: string, refund: Refund): SquareWebhookPayload {
  return { type, data: { object: { refund } } };
}

describe('mapSquareWebhookEvent', () => {
  it('keeps a PENDING payment (an ACH bank transfer clearing) as processing', () => {
    expect(
      mapSquareWebhookEvent(paymentEvent({ id: 'sq_1', status: 'PENDING' })),
    ).toMatchObject({ providerPaymentId: 'sq_1', status: 'processing' });
  });

  it('maps a payment update from its status (unchanged)', () => {
    expect(
      mapSquareWebhookEvent(
        paymentEvent({
          id: 'sq_1',
          status: 'COMPLETED',
          total_money: { amount: 5000, currency: 'USD' },
        }),
      ),
    ).toEqual({
      type: 'payment.updated',
      providerPaymentId: 'sq_1',
      status: 'succeeded',
    });

    expect(
      mapSquareWebhookEvent(paymentEvent({ id: 'sq_1', status: 'FAILED' })),
    ).toMatchObject({ status: 'failed' });
  });

  it('maps a payment update refunded in full to refunded', () => {
    expect(
      mapSquareWebhookEvent(
        paymentEvent({
          id: 'sq_1',
          status: 'COMPLETED',
          amount_money: { amount: 5000, currency: 'USD' },
          total_money: { amount: 5000, currency: 'USD' },
          refunded_money: { amount: 5000, currency: 'USD' },
        }),
      ),
    ).toEqual({
      type: 'payment.updated',
      providerPaymentId: 'sq_1',
      status: 'refunded',
    });
  });

  it('keeps the payment status (and logs) on a partially refunded payment update', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      mapSquareWebhookEvent(
        paymentEvent({
          id: 'sq_1',
          status: 'COMPLETED',
          total_money: { amount: 5000, currency: 'USD' },
          refunded_money: { amount: 1000, currency: 'USD' },
        }),
      ),
    ).toEqual({
      type: 'payment.updated',
      providerPaymentId: 'sq_1',
      status: 'succeeded',
    });
    expect(log).toHaveBeenCalled();
  });

  it.each(['refund.created', 'refund.updated'])(
    'maps a COMPLETED %s to refunded, guarded by the refund amount',
    (type) => {
      expect(
        mapSquareWebhookEvent(
          refundEvent(type, {
            id: 'rf_1',
            status: 'COMPLETED',
            payment_id: 'sq_1',
            amount_money: { amount: 5000, currency: 'USD' },
          }),
        ),
      ).toEqual({
        type,
        providerPaymentId: 'sq_1',
        status: 'refunded',
        onlyIfAmount: 5000,
      });
    },
  );

  it.each(['PENDING', 'REJECTED'])(
    'ignores a refund whose status is %s',
    (status) => {
      expect(
        mapSquareWebhookEvent(
          refundEvent('refund.updated', {
            id: 'rf_1',
            status,
            payment_id: 'sq_1',
            amount_money: { amount: 5000, currency: 'USD' },
          }),
        ),
      ).toBeNull();
    },
  );

  it('logs a FAILED refund at error level for the FS, without changing status', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      mapSquareWebhookEvent(
        refundEvent('refund.updated', {
          id: 'rf_1',
          status: 'FAILED',
          payment_id: 'sq_1',
          amount_money: { amount: 5000, currency: 'USD' },
        }),
      ),
    ).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/reconcile/i),
      expect.objectContaining({ paymentId: 'sq_1', refundId: 'rf_1' }),
    );
  });

  it('ignores events with neither a payment nor a refund', () => {
    expect(
      mapSquareWebhookEvent({ type: 'customer.created', data: { object: {} } }),
    ).toBeNull();
  });
});
