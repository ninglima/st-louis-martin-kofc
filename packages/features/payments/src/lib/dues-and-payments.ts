import { daysBetween, formatDueDate, inDays } from '@kit/dues/lib/dues-display';
import { formatAmountCents } from '@kit/dues/lib/format-amount';
import type { MemberDuesSummary } from '@kit/dues/types';

import type { Payment, PaymentStatus } from '../types/payment.types';
import {
  type PaymentAttention,
  shortDate,
  summarizeMyPayments,
} from './my-payments';

const CHECKOUT = '/home/checkout';

/** Calm colours only: the member's own card never shows a red badge. */
export type CalmBadgeVariant = 'default' | 'secondary' | 'outline';

export interface DuesAndPaymentsView {
  /** `action` gives the card a brand-coloured edge; `ok` gives it none. */
  tone: 'ok' | 'action';
  badge: { label: string; variant: CalmBadgeVariant } | null;
  headline: string | null;
  detail: string | null;
  note: string | null;
  action: { label: string; href: string } | null;
  /** Payments needing a word that the headline is not about. */
  secondary: {
    id: string;
    status: PaymentStatus;
    text: string;
    retry: boolean;
  }[];
  /** `'3 payments · $174.00 since July 1'`. */
  yearLine: string;
}

type Lead = Pick<
  DuesAndPaymentsView,
  'badge' | 'headline' | 'detail' | 'note' | 'action'
>;

const NO_LEAD: Lead = {
  badge: null,
  headline: null,
  detail: null,
  note: null,
  action: null,
};

function paymentLead(item: PaymentAttention): Lead {
  const { payment } = item;
  const amount = formatAmountCents(payment.amount);

  if (payment.status === 'failed') {
    return {
      badge: { label: 'Not completed', variant: 'outline' },
      headline: "Your recent payment didn't go through",
      detail: `Your ${amount} dues payment on ${shortDate(payment.created_at)} wasn't completed, so no charge was made. You're welcome to try again.`,
      note: null,
      action: { label: 'Try again', href: CHECKOUT },
    };
  }

  // processing, or pending within its window.
  return {
    badge: { label: 'Processing', variant: 'secondary' },
    headline: 'Your payment is being processed',
    detail: `We'll update your dues as soon as your ${amount} payment clears (started ${shortDate(payment.created_at)}).`,
    note: null,
    // No pay button while a payment is in flight: it invites a second charge.
    action: null,
  };
}

function duesLead(
  dues: MemberDuesSummary,
  today: string,
  paidOnline: boolean,
): Lead {
  const amount = formatAmountCents(dues.amountCents);
  const forLevel = `${amount} for ${dues.levelName}`;

  switch (dues.duesStatus) {
    case 'current':
      return {
        badge: { label: 'Paid', variant: 'default' },
        headline: 'Your dues are paid — thank you',
        detail: dues.paidThrough
          ? `Paid until ${formatDueDate(dues.paidThrough)}`
          : dues.levelName,
        note: null,
        action: null,
      };

    case 'due_soon': {
      const renews = dues.paidThrough ?? today;

      return {
        badge: { label: 'Renewal soon', variant: 'secondary' },
        headline: 'Your dues renewal is coming up',
        detail: `Renews ${formatDueDate(renews)} (${inDays(daysBetween(today, renews))}) · ${amount}`,
        note: null,
        action: { label: 'Renew dues', href: CHECKOUT },
      };
    }

    case 'lapsed':
      return {
        badge: { label: 'Renewal due', variant: 'outline' },
        headline: 'Your dues are ready to renew',
        detail: dues.paidThrough
          ? `Your last dues term ended ${formatDueDate(dues.paidThrough)} · ${amount}`
          : forLevel,
        note: null,
        action: { label: 'Renew dues', href: CHECKOUT },
      };

    case 'due':
      return {
        badge: { label: 'First payment', variant: 'outline' },
        headline: 'Your first dues payment is ready',
        detail: forLevel,
        note: null,
        action: { label: 'Pay dues', href: CHECKOUT },
      };

    case 'no_record':
      return {
        badge: { label: 'Not on file', variant: 'outline' },
        headline: "We don't have a dues payment on file yet",
        detail: forLevel,
        // Only while nothing has been tried online: after a refund or a
        // failed attempt the line would read as beside the point.
        note: paidOnline
          ? null
          : "If you've already paid by check or cash, there's nothing more to do. The Financial Secretary will record it.",
        action: { label: 'Pay dues', href: CHECKOUT },
      };
  }
}

/**
 * The member home's one dues-and-payments card, in words.
 *
 * The headline follows the payment status first: a dues payment in flight
 * ("being processed", no pay button) or a recent failed one ("didn't go
 * through", try again). Otherwise it follows the dues status. Every other
 * payment that needs a word becomes a quiet line beneath. The wording stays
 * polite and calm: "ready to renew", never "past due".
 */
export function describeDuesAndPayments(
  dues: MemberDuesSummary | null,
  payments: Payment[],
  now: Date,
  today: string,
): DuesAndPaymentsView {
  const summary = summarizeMyPayments(payments, now, today);

  const leadItem = summary.attention.find(
    (item) =>
      item.payment.payment_type === 'dues' &&
      ['processing', 'pending', 'failed'].includes(item.payment.status),
  );

  const paidOnline = payments.some((p) => p.payment_type === 'dues');

  const lead = leadItem
    ? paymentLead(leadItem)
    : dues
      ? duesLead(dues, today, paidOnline)
      : NO_LEAD;

  const secondary = summary.attention
    .filter((item) => item !== leadItem)
    .map((item) => ({
      id: item.payment.id,
      status: item.payment.status,
      text: item.text,
      retry: item.retry,
    }));

  const wantsAttention =
    lead.action !== null ||
    leadItem !== undefined ||
    secondary.some((s) => s.status !== 'refunded' && s.status !== 'cancelled');

  const since = formatDueDate(summary.yearStart).replace(/, \d{4}$/, '');

  return {
    ...lead,
    tone: wantsAttention ? 'action' : 'ok',
    secondary,
    yearLine:
      summary.yearCount === 0
        ? `No payments since ${since}`
        : `${summary.yearCount} ${summary.yearCount === 1 ? 'payment' : 'payments'} · ${formatAmountCents(summary.yearTotalCents)} since ${since}`,
  };
}
