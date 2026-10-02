import type { DuesStatus, MemberDuesSummary } from '../types';
import { formatAmountCents } from './format-amount';

/** How loudly the card speaks: `owed` asks for payment now, `attention` says
 * it is coming up, `ok` says nothing is needed. */
export type MyDuesTone = 'ok' | 'attention' | 'owed';

export interface MyDuesDescription {
  tone: MyDuesTone;
  headline: string;
  detail: string;
  note: string | null;
  payable: boolean;
}

/**
 * Every status except `current` is offered checkout. `no_record` included:
 * an online payment for a member with neither a paid period nor an
 * acceptance date starts its period on the day it is received (see
 * `dues_online_and_load.sql`), so there is no period to get wrong.
 */
export function isPayable(status: DuesStatus): boolean {
  return status !== 'current';
}

/** `'2027-08-01'` -> `'August 1, 2027'`, read as a calendar date in UTC so the
 * day never shifts with the viewer's time zone. */
export function formatDueDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  const DAY_MS = 86_400_000;

  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

function inDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';

  return `in ${days} days`;
}

function daysAgo(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';

  return `${days} days ago`;
}

/**
 * The member's own dues standing in words, for the home dashboard.
 *
 * `paidThrough` is the first day NOT covered (a period's exclusive end), so
 * the copy says "paid until" / "due" / "expired" on that date rather than
 * "paid through" it. `today` is the council's date (`chicagoToday()`), the
 * same one the database uses to compute `duesStatus`.
 */
export function describeMyDues(
  summary: MemberDuesSummary,
  today: string,
): MyDuesDescription {
  const amount = formatAmountCents(summary.amountCents);
  const forLevel = `${amount} for ${summary.levelName}`;
  const payable = isPayable(summary.duesStatus);

  switch (summary.duesStatus) {
    case 'current':
      return {
        tone: 'ok',
        headline: 'Your dues are paid',
        detail: summary.paidThrough
          ? `Paid until ${formatDueDate(summary.paidThrough)}`
          : summary.levelName,
        note: null,
        payable,
      };

    case 'due_soon': {
      const due = summary.paidThrough ?? today;

      return {
        tone: 'attention',
        headline: 'Your dues are due soon',
        detail: `Due ${formatDueDate(due)} (${inDays(daysBetween(today, due))}) · ${amount}`,
        note: null,
        payable,
      };
    }

    case 'lapsed': {
      const expired = summary.paidThrough ?? today;

      return {
        tone: 'owed',
        headline: 'Your dues are past due',
        detail: `Expired ${formatDueDate(expired)} (${daysAgo(daysBetween(expired, today))}) · ${amount}`,
        note: null,
        payable,
      };
    }

    case 'due':
      return {
        tone: 'owed',
        headline: "Your dues haven't been paid yet",
        detail: forLevel,
        note: null,
        payable,
      };

    case 'no_record':
      return {
        tone: 'owed',
        headline: 'We have no record of your dues payment',
        detail: forLevel,
        note: 'If you paid by check or cash, the Financial Secretary may not have recorded it yet.',
        payable,
      };
  }
}
