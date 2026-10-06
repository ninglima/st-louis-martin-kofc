import { describe, expect, it } from 'vitest';

import type { Payment } from '../types/payment.types';
import { summarizeMyPayments } from './my-payments';

// 2026-10-02 10:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-02T15:00:00Z');
const TODAY = '2026-10-02';

let seq = 0;

function payment(overrides: Partial<Payment>): Payment {
  seq += 1;

  return {
    id: `p${seq}`,
    user_id: 'u1',
    provider: 'stripe',
    provider_payment_id: null,
    amount: 5800,
    currency: 'usd',
    status: 'succeeded',
    payment_type: 'dues',
    description: null,
    metadata: {},
    receipt_sent_at: null,
    receipt_error: null,
    created_at: '2026-09-15T15:00:00Z',
    updated_at: '2026-09-15T15:00:00Z',
    ...overrides,
  };
}

describe('summarizeMyPayments', () => {
  it('is quiet with no payments', () => {
    expect(summarizeMyPayments([], NOW, TODAY)).toEqual({
      attention: [],
      yearCount: 0,
      yearTotalCents: 0,
      yearStart: '2026-07-01',
    });
  });

  it('totals succeeded payments since July 1 of the fraternal year', () => {
    const summary = summarizeMyPayments(
      [
        payment({ created_at: '2026-09-15T15:00:00Z', amount: 5800 }),
        payment({ created_at: '2026-07-01T06:00:00Z', amount: 2000 }),
        // June 30 at 11 pm in Chicago is still the previous fraternal year,
        // although it is already July 1 in UTC.
        payment({ created_at: '2026-07-01T04:00:00Z', amount: 9999 }),
        payment({ status: 'failed', created_at: '2026-09-20T15:00:00Z' }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.yearCount).toBe(2);
    expect(summary.yearTotalCents).toBe(7800);
  });

  it('starts the fraternal year in the previous calendar year before July', () => {
    expect(summarizeMyPayments([], NOW, '2027-03-01').yearStart).toBe(
      '2026-07-01',
    );
  });

  it('flags a processing payment however old it is', () => {
    const summary = summarizeMyPayments(
      [payment({ status: 'processing', created_at: '2026-08-01T15:00:00Z' })],
      NOW,
      TODAY,
    );

    expect(summary.attention).toEqual([
      {
        payment: expect.objectContaining({ status: 'processing' }),
        text: '$58.00 dues payment processing (started Aug 1)',
        retry: false,
      },
    ]);
  });

  it('shows a pending payment only within 24 hours of starting', () => {
    const fresh = payment({
      status: 'pending',
      payment_type: 'donation',
      amount: 2500,
      created_at: '2026-10-02T13:00:00Z',
    });
    const abandoned = payment({
      status: 'pending',
      created_at: '2026-10-01T14:59:00Z',
    });

    const summary = summarizeMyPayments([fresh, abandoned], NOW, TODAY);

    expect(summary.attention.map((a) => a.text)).toEqual([
      '$25.00 donation payment in progress (started Oct 2)',
    ]);
  });

  it('offers a retry for a recent failed payment', () => {
    const summary = summarizeMyPayments(
      [
        payment({
          status: 'failed',
          payment_type: 'event_fee',
          amount: 1500,
          created_at: '2026-10-02T02:00:00Z',
        }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention).toEqual([
      {
        payment: expect.objectContaining({ status: 'failed' }),
        // 02:00 UTC on Oct 2 is 9 pm on Oct 1 in Chicago.
        text: "Your $15.00 event fee payment on Oct 1 didn't go through",
        retry: true,
      },
    ]);
  });

  it('drops a failed or cancelled payment older than 30 days', () => {
    const summary = summarizeMyPayments(
      [
        payment({ status: 'failed', created_at: '2026-09-01T14:00:00Z' }),
        payment({ status: 'cancelled', created_at: '2026-08-15T15:00:00Z' }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention).toEqual([]);
  });

  it('drops a failed or cancelled payment once a later one of the same type succeeded', () => {
    const summary = summarizeMyPayments(
      [
        payment({ status: 'failed', created_at: '2026-09-20T15:00:00Z' }),
        payment({ status: 'cancelled', created_at: '2026-09-21T15:00:00Z' }),
        payment({ status: 'succeeded', created_at: '2026-09-22T15:00:00Z' }),
        // A donation failure stays: the success above was dues.
        payment({
          status: 'failed',
          payment_type: 'donation',
          created_at: '2026-09-23T15:00:00Z',
        }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention.map((a) => a.text)).toEqual([
      "Your $58.00 donation payment on Sep 23 didn't go through",
    ]);
  });

  it('keeps a failure that came after the last success', () => {
    const summary = summarizeMyPayments(
      [
        payment({ status: 'succeeded', created_at: '2026-09-20T15:00:00Z' }),
        payment({ status: 'failed', created_at: '2026-09-21T15:00:00Z' }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention).toHaveLength(1);
  });

  it('says a cancelled payment was cancelled, without a retry', () => {
    const summary = summarizeMyPayments(
      [payment({ status: 'cancelled', created_at: '2026-09-30T15:00:00Z' })],
      NOW,
      TODAY,
    );

    expect(summary.attention).toEqual([
      {
        payment: expect.objectContaining({ status: 'cancelled' }),
        text: '$58.00 dues payment on Sep 30 was cancelled',
        retry: false,
      },
    ]);
  });

  it('dates a refund by when it was refunded, for 30 days', () => {
    const summary = summarizeMyPayments(
      [
        payment({
          status: 'refunded',
          created_at: '2026-06-01T15:00:00Z',
          updated_at: '2026-09-28T15:00:00Z',
        }),
        payment({
          status: 'refunded',
          created_at: '2026-06-01T15:00:00Z',
          updated_at: '2026-08-28T15:00:00Z',
        }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention.map((a) => a.text)).toEqual([
      '$58.00 dues payment refunded on Sep 28',
    ]);
  });

  it('orders processing, pending, failed, cancelled, refunded, newest first within each', () => {
    const summary = summarizeMyPayments(
      [
        payment({ status: 'refunded', updated_at: '2026-10-01T15:00:00Z' }),
        payment({
          status: 'cancelled',
          payment_type: 'donation',
          created_at: '2026-10-01T15:00:00Z',
        }),
        payment({
          status: 'failed',
          payment_type: 'event_fee',
          created_at: '2026-09-29T15:00:00Z',
        }),
        payment({
          status: 'failed',
          payment_type: 'event_fee',
          created_at: '2026-09-30T15:00:00Z',
        }),
        payment({ status: 'pending', created_at: '2026-10-02T14:00:00Z' }),
        payment({ status: 'processing', created_at: '2026-10-01T15:00:00Z' }),
      ],
      NOW,
      TODAY,
    );

    expect(summary.attention.map((a) => a.payment.status)).toEqual([
      'processing',
      'pending',
      'failed',
      'failed',
      'cancelled',
      'refunded',
    ]);
    expect(summary.attention[2]?.text).toContain('Sep 30');
  });
});
