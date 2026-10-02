import { escapeHtml } from '@kit/email/html';
import { formatAmountCents } from '@kit/dues/lib/format-amount';

import type { ClaimedNotice, NoticeKind } from './types';

const SUBJECTS: Record<NoticeKind, string> = {
  before_30: 'Your council dues renew soon',
  due_date: 'Your council dues are due',
  after_30: 'Your council dues are past due',
};

/** 2026-11-14 (exclusive) -> "November 13, 2026", the last day covered. */
function lastCoveredDay(cycleDate: string): string {
  const d = new Date(`${cycleDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * A first-dues member has no prior cycle to reference, so each kind gets its
 * own wording instead of the "paid through" framing renewals use.
 * `before_30` cannot fire for a first-dues member in practice (their window
 * falls before acceptance), but it is still handled rather than left to fall
 * through.
 */
function firstDuesBody(n: ClaimedNotice, amount: string): string[] {
  switch (n.kind) {
    case 'before_30':
      return [
        `Welcome to the council. Your first dues of ${amount} (${n.levelName}) will be due soon.`,
        'You can pay online in the member portal.',
      ];
    case 'due_date':
      return [
        `Welcome to the council. Your first dues of ${amount} (${n.levelName}) are now due.`,
        'You can pay online in the member portal.',
      ];
    case 'after_30':
      return [
        `Your first dues of ${amount} (${n.levelName}) are now past due.`,
        'You can pay online in the member portal.',
      ];
  }
}

function body(n: ClaimedNotice): string[] {
  const amount = formatAmountCents(n.amountCents);

  if (n.firstDues) {
    return firstDuesBody(n, amount);
  }

  const through = lastCoveredDay(n.cycleDate);

  switch (n.kind) {
    case 'before_30':
      return [
        `Your dues are paid through ${through}.`,
        `Renewing now keeps you current: ${amount} (${n.levelName}).`,
      ];
    case 'due_date':
      return [
        `Your dues were paid through ${through} and are now due.`,
        `Your renewal is ${amount} (${n.levelName}).`,
      ];
    case 'after_30':
      return [
        `Your dues were paid through ${through} and are now past due.`,
        `Your renewal is ${amount} (${n.levelName}).`,
      ];
  }
}

export function renderNotice(
  n: ClaimedNotice,
  siteUrl: string,
): { subject: string; html: string; text: string } {
  const payUrl = `${siteUrl}/home/checkout`;
  const lines = body(n);
  const stop =
    'To stop these reminders, reply to this email and let the Financial Secretary know.';

  const text = [
    `Dear ${n.firstName},`,
    '',
    ...lines,
    '',
    `Pay dues: ${payUrl}`,
    '',
    stop,
  ].join('\n');

  const html = [
    `<p>Dear ${escapeHtml(n.firstName)},</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    `<p><a href="${escapeHtml(payUrl)}">Pay dues</a></p>`,
    `<p style="color:#666;font-size:12px">${escapeHtml(stop)}</p>`,
  ].join('\n');

  return { subject: SUBJECTS[n.kind], html, text };
}
