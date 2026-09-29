import { formatAmountCents } from '@kit/dues/lib/format-amount';

import type { ClaimedNotice, NoticeKind } from './types';

const SUBJECTS: Record<NoticeKind, string> = {
  before_30: 'Your council dues renew soon',
  due_date: 'Your council dues are due',
  after_30: 'Your council dues are past due',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function body(n: ClaimedNotice): string[] {
  const amount = formatAmountCents(n.amountCents);

  if (n.firstDues) {
    return [
      `Welcome to the council. Your first dues of ${amount} (${n.levelName}) are now due.`,
      'You can pay online in the member portal.',
    ];
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
