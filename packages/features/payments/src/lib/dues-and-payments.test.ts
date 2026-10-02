import { describe, expect, it } from 'vitest';

import type { MemberDuesSummary } from '@kit/dues/types';

import type { Payment } from '../types/payment.types';
import { describeDuesAndPayments } from './dues-and-payments';

// 2026-10-02 10:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-02T15:00:00Z');
const TODAY = '2026-10-02';

const dues: MemberDuesSummary = {
  memberId: 'm1',
  duesLevel: 'regular',
  levelName: 'Regular (with voluntary contribution)',
  amountCents: 5800,
  acceptedOn: '2025-08-01',
  isStudent: false,
  paidThrough: null,
  duesStatus: 'no_record',
};

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
    created_at: '2026-09-15T15:00:00Z',
    updated_at: '2026-09-15T15:00:00Z',
    ...overrides,
  };
}

const view = (d: MemberDuesSummary | null, payments: Payment[] = []) =>
  describeDuesAndPayments(d, payments, NOW, TODAY);

describe('describeDuesAndPayments: dues standing', () => {
  it('thanks a member who is paid up, and asks nothing', () => {
    expect(
      view({ ...dues, duesStatus: 'current', paidThrough: '2027-08-01' }, [
        payment({}),
      ]),
    ).toMatchObject({
      tone: 'ok',
      badge: { label: 'Paid' },
      headline: 'Your dues are paid — thank you',
      detail: 'Paid until August 1, 2027',
      note: null,
      action: null,
      yearLine: '1 payment · $58.00 since July 1',
    });
  });

  it('mentions an upcoming renewal with the days left', () => {
    expect(
      view({ ...dues, duesStatus: 'due_soon', paidThrough: '2026-11-13' }),
    ).toMatchObject({
      tone: 'action',
      badge: { label: 'Renewal soon' },
      headline: 'Your dues renewal is coming up',
      detail: 'Renews November 13, 2026 (in 42 days) · $58.00',
      action: { label: 'Renew dues', href: '/home/checkout' },
    });
  });

  it('invites a renewal, without alarm, once the term has ended', () => {
    expect(
      view({ ...dues, duesStatus: 'lapsed', paidThrough: '2026-08-01' }),
    ).toMatchObject({
      tone: 'action',
      badge: { label: 'Renewal due' },
      headline: 'Your dues are ready to renew',
      detail: 'Your last dues term ended August 1, 2026 · $58.00',
      action: { label: 'Renew dues' },
    });
  });

  it('presents a first payment', () => {
    expect(view({ ...dues, duesStatus: 'due' })).toMatchObject({
      badge: { label: 'First payment' },
      headline: 'Your first dues payment is ready',
      detail: '$58.00 for Regular (with voluntary contribution)',
      note: null,
      action: { label: 'Pay dues' },
    });
  });

  it('reassures a member with nothing on file who may have paid offline', () => {
    expect(
      view({ ...dues, duesStatus: 'no_record', acceptedOn: null }),
    ).toMatchObject({
      tone: 'action',
      badge: { label: 'Not on file' },
      headline: "We don't have a dues payment on file yet",
      detail: '$58.00 for Regular (with voluntary contribution)',
      note: "If you've already paid by check or cash, there's nothing more to do. The Financial Secretary will record it.",
      action: { label: 'Pay dues' },
      yearLine: 'No payments since July 1',
    });
  });

  it('drops the check-or-cash note once there is any online dues payment', () => {
    const result = view({ ...dues, duesStatus: 'no_record' }, [
      payment({
        status: 'refunded',
        created_at: '2026-10-01T15:00:00Z',
        updated_at: '2026-10-02T14:00:00Z',
      }),
    ]);

    expect(result.note).toBeNull();
    expect(result.secondary.map((s) => s.text)).toEqual([
      '$58.00 dues payment refunded on Oct 2',
    ]);
  });
});

describe('describeDuesAndPayments: payment status first', () => {
  it('says a dues payment is processing instead of asking for another', () => {
    expect(
      view({ ...dues, duesStatus: 'lapsed', paidThrough: '2026-08-01' }, [
        payment({ status: 'processing', created_at: '2026-10-02T13:00:00Z' }),
      ]),
    ).toMatchObject({
      tone: 'action',
      badge: { label: 'Processing' },
      headline: 'Your payment is being processed',
      detail:
        "We'll update your dues as soon as your $58.00 payment clears (started Oct 2).",
      action: null,
      secondary: [],
    });
  });

  it('treats a fresh pending dues payment the same way', () => {
    expect(
      view({ ...dues, duesStatus: 'due' }, [
        payment({ status: 'pending', created_at: '2026-10-02T14:00:00Z' }),
      ]).headline,
    ).toBe('Your payment is being processed');
  });

  it('ignores an abandoned pending checkout', () => {
    expect(
      view({ ...dues, duesStatus: 'due' }, [
        payment({ status: 'pending', created_at: '2026-09-30T14:00:00Z' }),
      ]).headline,
    ).toBe('Your first dues payment is ready');
  });

  it('explains a failed dues payment and offers to try again', () => {
    expect(
      view({ ...dues, duesStatus: 'lapsed', paidThrough: '2026-08-01' }, [
        payment({ status: 'failed', created_at: '2026-10-02T02:00:00Z' }),
      ]),
    ).toMatchObject({
      tone: 'action',
      badge: { label: 'Not completed' },
      headline: "Your recent payment didn't go through",
      detail:
        "Your $58.00 dues payment on Oct 1 wasn't completed, so no charge was made. You're welcome to try again.",
      action: { label: 'Try again', href: '/home/checkout' },
      secondary: [],
    });
  });

  it('leaves the dues headline alone for a non-dues payment, listing it below', () => {
    const result = view(
      { ...dues, duesStatus: 'current', paidThrough: '2027-08-01' },
      [
        payment({
          status: 'failed',
          payment_type: 'donation',
          amount: 2500,
          created_at: '2026-10-01T15:00:00Z',
        }),
      ],
    );

    expect(result.headline).toBe('Your dues are paid — thank you');
    expect(result.secondary).toEqual([
      {
        id: expect.any(String),
        status: 'failed',
        text: "Your $25.00 donation payment on Oct 1 didn't go through",
        retry: true,
      },
    ]);
    // Something on the card still wants the member's attention.
    expect(result.tone).toBe('action');
  });

  it('lists the other payments needing a word under the headline', () => {
    const result = view({ ...dues, duesStatus: 'due' }, [
      payment({ status: 'processing', created_at: '2026-10-02T13:00:00Z' }),
      payment({ status: 'failed', created_at: '2026-10-01T15:00:00Z' }),
    ]);

    expect(result.headline).toBe('Your payment is being processed');
    expect(result.secondary.map((s) => s.status)).toEqual(['failed']);
  });
});

describe('describeDuesAndPayments: no dues summary', () => {
  it('still reports payments when dues are not available', () => {
    expect(view(null, [payment({})])).toMatchObject({
      tone: 'ok',
      badge: null,
      headline: null,
      detail: null,
      action: null,
      yearLine: '1 payment · $58.00 since July 1',
    });
  });
});
