import { escapeHtml } from '@kit/email/html';
import { formatDay, formatTimeRange } from '@kit/events/lib/format';

import { buildIcs, eventUrl, icsMethod } from './ics';
import type { ClaimedEventEmail } from './types';

export interface RenderedEventEmail {
  subject: string;
  html: string;
  text: string;
  ics?: { filename: string; content: string; contentType: string };
}

type RenderKind = 'confirmation' | 'update' | 'cancel' | 'reminder';

export function renderEventEmail(
  e: ClaimedEventEmail,
  opts: { siteUrl: string; from: string; now?: Date },
): RenderedEventEmail {
  // The DB can hand over a confirmation or update for an event cancelled
  // before it was sent; that is a cancellation.
  const kind: RenderKind =
    e.kind !== 'reminder' && e.eventStatus === 'cancelled' ? 'cancel' : e.kind;
  const { siteUrl } = opts;
  const link = eventUrl(siteUrl, e.eventId);
  const what = e.shiftLabel ? `${e.title} — ${e.shiftLabel}` : e.title;

  const rawSubject = {
    confirmation: `You're signed up: ${e.title}`,
    update: `Updated: ${e.title}`,
    cancel: `Cancelled: ${e.title}`,
    reminder: `Reminder: ${e.title} tomorrow`,
  }[kind];
  const subject = rawSubject.replace(/\s+/g, ' ').trim();

  const intro = {
    confirmation: `You're signed up for ${what}.`,
    update: 'The details have changed — the new details are below.',
    cancel: 'This event has been cancelled. No action is needed.',
    reminder: `A reminder that you're volunteering tomorrow: ${what}.`,
  }[kind];

  const details = [
    `What: ${what}`,
    `When: ${formatDay(e.shiftStartsAt)}, ${formatTimeRange(e.shiftStartsAt, e.shiftEndsAt)} (Central Time)`,
    ...(e.location ? [`Where: ${e.location}`] : []),
  ];

  const prefsUrl = link ? `${siteUrl}/home/volunteering` : null;
  const optOut = "Don't want reminders? Turn them off on My volunteering";
  const showFooter = kind === 'reminder';

  const text = [
    `Dear ${e.firstName},`,
    '',
    intro,
    '',
    ...details,
    ...(link ? ['', `Event details: ${link}`] : []),
    ...(showFooter
      ? ['', prefsUrl ? `${optOut}: ${prefsUrl}` : `${optOut}.`]
      : []),
  ].join('\n');

  const html = [
    `<p>Dear ${escapeHtml(e.firstName)},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${details.map(escapeHtml).join('<br>')}</p>`,
    ...(link
      ? [`<p><a href="${escapeHtml(link)}">View the event</a></p>`]
      : []),
    ...(showFooter
      ? [
          `<p style="color:#666;font-size:12px">${escapeHtml(optOut)}${
            prefsUrl
              ? `: <a href="${escapeHtml(prefsUrl)}">${escapeHtml(prefsUrl)}</a>`
              : '.'
          }</p>`,
        ]
      : []),
  ].join('\n');

  if (kind === 'reminder') return { subject, html, text };

  const method = icsMethod({ ...e, kind });
  const content = buildIcs(
    { ...e, kind },
    { siteUrl, from: opts.from },
    opts.now,
  );

  return {
    subject,
    html,
    text,
    ics: {
      filename: 'event.ics',
      content: Buffer.from(content, 'utf8').toString('base64'),
      contentType: `text/calendar; method=${method}; charset=UTF-8`,
    },
  };
}
