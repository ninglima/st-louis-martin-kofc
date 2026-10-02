import { formatAmountCents } from '@kit/dues/lib/format-amount';

import type {
  Payment,
  PaymentStatus,
  PaymentType,
} from '../types/payment.types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A `pending` row is written the moment checkout opens, before anything is
 * charged; past this it is an abandoned checkout, not a payment in flight. */
const PENDING_FOR_MS = 24 * HOUR_MS;
/** How long a failed, cancelled or refunded payment stays on the card. */
const RECENT_FOR_MS = 30 * DAY_MS;

const ORDER: PaymentStatus[] = [
  'processing',
  'pending',
  'failed',
  'cancelled',
  'refunded',
];

const TYPE_LABELS: Record<PaymentType, string> = {
  dues: 'dues',
  donation: 'donation',
  event_fee: 'event fee',
};

/** `owed` when a payment failed, `attention` when one is in flight. */
export type MyPaymentsTone = 'ok' | 'attention' | 'owed';

export interface PaymentAttention {
  id: string;
  status: PaymentStatus;
  text: string;
  retry: boolean;
}

export interface MyPaymentsSummary {
  tone: MyPaymentsTone;
  attention: PaymentAttention[];
  yearCount: number;
  yearTotalCents: number;
  /** July 1 of the current fraternal year, as `YYYY-MM-DD`. */
  yearStart: string;
}

/** `'2026-10-02T02:00:00Z'` -> `'Oct 1'`: the council's (Chicago) date. */
function shortDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

/** The council's (Chicago) calendar date of a timestamp, as `YYYY-MM-DD`. */
function chicagoDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

/** The fraternal year runs July 1 to June 30, as on the finance dashboard. */
function fraternalYearStart(today: string): string {
  const [year, month] = today.split('-').map(Number) as [number, number];

  return `${month < 7 ? year - 1 : year}-07-01`;
}

function describe(payment: Payment): string {
  const what = `${formatAmountCents(payment.amount)} ${TYPE_LABELS[payment.payment_type]}`;

  switch (payment.status) {
    case 'processing':
      return `Payment processing — ${what}, started ${shortDate(payment.created_at)}`;
    case 'pending':
      return `Payment in progress — ${what}, started ${shortDate(payment.created_at)}`;
    case 'failed':
      return `Your ${what} payment on ${shortDate(payment.created_at)} failed`;
    case 'cancelled':
      return `Your ${what} payment on ${shortDate(payment.created_at)} was cancelled`;
    case 'refunded':
      return `${what} payment refunded on ${shortDate(payment.updated_at)}`;
    case 'succeeded':
      return what;
  }
}

/**
 * The member's own payments, reduced to what the home dashboard says about
 * them: the ones that need a word (in flight, failed, cancelled, refunded)
 * and one total of what succeeded this fraternal year.
 *
 * A failed or cancelled payment drops off once a later payment of the same
 * type succeeded -- the member already fixed it. `now` decides the time
 * windows; `today` (the Chicago date) decides the fraternal year.
 */
export function summarizeMyPayments(
  payments: Payment[],
  now: Date,
  today: string,
): MyPaymentsSummary {
  const nowMs = now.getTime();
  const ageMs = (timestamp: string) => nowMs - Date.parse(timestamp);
  const yearStart = fraternalYearStart(today);

  const lastSuccessByType = new Map<PaymentType, number>();

  for (const payment of payments) {
    if (payment.status !== 'succeeded') continue;

    const at = Date.parse(payment.created_at);
    const seen = lastSuccessByType.get(payment.payment_type) ?? -Infinity;

    lastSuccessByType.set(payment.payment_type, Math.max(seen, at));
  }

  const fixedLater = (payment: Payment) =>
    (lastSuccessByType.get(payment.payment_type) ?? -Infinity) >
    Date.parse(payment.created_at);

  const needsAWord = (payment: Payment): boolean => {
    switch (payment.status) {
      case 'processing':
        return true;
      case 'pending':
        return ageMs(payment.created_at) <= PENDING_FOR_MS;
      case 'failed':
      case 'cancelled':
        return (
          ageMs(payment.created_at) <= RECENT_FOR_MS && !fixedLater(payment)
        );
      case 'refunded':
        return ageMs(payment.updated_at) <= RECENT_FOR_MS;
      case 'succeeded':
        return false;
    }
  };

  const sortKey = (payment: Payment) =>
    Date.parse(
      payment.status === 'refunded' ? payment.updated_at : payment.created_at,
    );

  const attention = payments
    .filter(needsAWord)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
        sortKey(b) - sortKey(a),
    )
    .map((payment) => ({
      id: payment.id,
      status: payment.status,
      text: describe(payment),
      retry: payment.status === 'failed',
    }));

  const thisYear = payments.filter(
    (payment) =>
      payment.status === 'succeeded' &&
      chicagoDate(payment.created_at) >= yearStart,
  );

  const tone: MyPaymentsTone = attention.some((a) => a.status === 'failed')
    ? 'owed'
    : attention.some((a) => a.status === 'processing' || a.status === 'pending')
      ? 'attention'
      : 'ok';

  return {
    tone,
    attention,
    yearCount: thisYear.length,
    yearTotalCents: thisYear.reduce((sum, payment) => sum + payment.amount, 0),
    yearStart,
  };
}
