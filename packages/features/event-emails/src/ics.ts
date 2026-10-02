import type { ClaimedEventEmail } from './types';

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, String.raw`\;`)
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** UTC basic format, YYYYMMDDTHHMMSSZ. */
function utc(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;

  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Fold a content line at 75 octets, never splitting a code point. */
function fold(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  // Continuation lines start with a space, which counts toward the limit.
  let limit = 75;

  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');

    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }

    current += ch;
    bytes += size;
  }

  out.push(current);

  return out;
}

/** The address inside "Name <addr@host>", or the string as given. */
function mailbox(from: string): string {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim();
}

export type IcsMethod = 'PUBLISH' | 'CANCEL';

export function icsMethod(e: ClaimedEventEmail): IcsMethod {
  return e.kind === 'cancel' || e.eventStatus === 'cancelled'
    ? 'CANCEL'
    : 'PUBLISH';
}

export function eventUrl(siteUrl: string, eventId: string): string {
  return `${siteUrl}/home/events/${eventId}`;
}

export function buildIcs(
  e: ClaimedEventEmail,
  opts: { siteUrl: string; from: string },
  now: Date = new Date(),
): string {
  const method = icsMethod(e);
  const url = eventUrl(opts.siteUrl, e.eventId);
  const host = new URL(opts.siteUrl).host;
  const summary = e.shiftLabel ? `${e.title} — ${e.shiftLabel}` : e.title;
  const description = [e.description?.trim(), url].filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//St Louis Martin KofC//Portal//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:signup-${e.signupId}@${host}`,
    `DTSTAMP:${utc(now)}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTART:${utc(e.shiftStartsAt)}`,
    `DTEND:${utc(e.shiftEndsAt)}`,
    `SUMMARY:${escapeText(summary)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${url}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(method === 'CANCEL' ? [`ORGANIZER:mailto:${mailbox(opts.from)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.flatMap(fold).join('\r\n') + '\r\n';
}
