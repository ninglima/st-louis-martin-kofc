import { describe, expect, it } from 'vitest';

import { claimed } from './fixtures';
import { buildIcs } from './ics';

const opts = {
  siteUrl: 'https://portal.example.org',
  from: 'Council <council@example.org>',
};
const now = new Date('2026-10-02T12:34:56Z');

function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '');
}

describe('buildIcs', () => {
  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs(claimed(), opts, now);

    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('writes the calendar skeleton, UID, DTSTAMP and event URL', () => {
    const ics = buildIcs(claimed(), opts, now);

    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    expect(ics).toContain('PRODID:-//St Louis Martin KofC//Portal//EN');
    expect(ics).toContain('UID:signup-signup-uuid-1@portal.example.org');
    expect(ics).toContain('DTSTAMP:20261002T123456Z');
    expect(ics).toContain(
      'URL:https://portal.example.org/home/events/event-uuid-1',
    );
    expect(ics).toContain('LOCATION:Parish Hall\\, 123 Main St');
  });

  it('converts a Chicago evening to UTC', () => {
    const ics = buildIcs(claimed(), opts, now);

    expect(ics).toContain('DTSTART:20261107T010000Z');
    expect(ics).toContain('DTEND:20261107T030000Z');
  });

  it('keeps the UID stable for a signup and takes SEQUENCE from the row', () => {
    const a = buildIcs(claimed({ sequence: 0 }), opts, now);
    const b = buildIcs(
      claimed({ kind: 'update', sequence: 3 }),
      opts,
      new Date('2027-01-01T00:00:00Z'),
    );
    const uid = (s: string) => s.match(/UID:.*/)![0];

    expect(uid(a)).toBe(uid(b));
    expect(a).toContain('SEQUENCE:0');
    expect(b).toContain('SEQUENCE:3');
  });

  it('publishes a confirmation as CONFIRMED', () => {
    const ics = buildIcs(claimed(), opts, now);

    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).not.toContain('ORGANIZER');
  });

  it('cancels with METHOD:CANCEL, STATUS:CANCELLED and an organizer', () => {
    const ics = buildIcs(claimed({ kind: 'cancel', sequence: 2 }), opts, now);

    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('ORGANIZER:mailto:council@example.org');
  });

  it('adds the shift label to the summary and the URL to the description', () => {
    const ics = unfold(
      buildIcs(
        claimed({ shiftLabel: 'Setup', description: 'Bring gloves' }),
        opts,
        now,
      ),
    );

    expect(ics).toContain('SUMMARY:Fish Fry — Setup');
    expect(ics).toContain(
      'DESCRIPTION:Bring gloves\\n\\nhttps://portal.example.org/home/events/event-uuid-1',
    );
  });

  it('omits LOCATION when there is none', () => {
    expect(buildIcs(claimed({ location: null }), opts, now)).not.toContain(
      'LOCATION',
    );
  });

  it('escapes backslash, semicolon, comma and newlines', () => {
    const ics = unfold(
      buildIcs(
        claimed({ title: 'a,b;c\\d', description: 'line1\nline2\r\nline3' }),
        opts,
        now,
      ),
    );

    expect(ics).toContain(String.raw`SUMMARY:a\,b\;c\\d`);
    expect(ics).toContain('DESCRIPTION:line1\\nline2\\nline3');
  });

  it('folds long lines at 75 octets without splitting multibyte characters', () => {
    const title = 'Ünïcödé—'.repeat(25); // 200 characters
    const ics = buildIcs(claimed({ title }), opts, now);
    const lines = ics.split('\r\n').slice(0, -1);

    expect(lines.length).toBeGreaterThan(20);

    for (const line of lines) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }

    const summaryAt = lines.findIndex((l) => l.startsWith('SUMMARY:'));

    expect(lines[summaryAt + 1]!.startsWith(' ')).toBe(true);
    expect(unfold(ics)).toContain(`SUMMARY:${title}`);
    expect(ics).not.toContain('�');
  });

  it('renders an event cancelled before send as a cancel', () => {
    const ics = buildIcs(claimed({ eventStatus: 'cancelled' }), opts, now);

    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
  });
});
