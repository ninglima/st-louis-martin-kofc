import { describe, expect, it } from 'vitest';

import { claimed } from './fixtures';
import { renderEventEmail } from './templates';

const opts = {
  siteUrl: 'https://portal.example.org',
  from: 'Council <council@example.org>',
  now: new Date('2026-10-02T12:34:56Z'),
};

function decode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('renderEventEmail', () => {
  it('renders a confirmation with an attached PUBLISH calendar file', () => {
    const r = renderEventEmail(claimed(), opts);

    expect(r.subject).toBe("You're signed up: Fish Fry");
    expect(r.text).toContain('Dear Nick,');
    expect(r.text).toContain('Fri, Nov 6, 2026');
    expect(r.text).toContain('7:00 PM – 9:00 PM');
    expect(r.text).toContain('Parish Hall, 123 Main St');
    expect(r.text).toContain(
      'https://portal.example.org/home/events/event-uuid-1',
    );
    expect(r.html).toContain(
      'href="https://portal.example.org/home/events/event-uuid-1"',
    );
    expect(r.ics?.filename).toBe('event.ics');
    expect(r.ics?.contentType).toBe(
      'text/calendar; method=PUBLISH; charset=UTF-8',
    );
    expect(decode(r.ics!.content)).toContain('METHOD:PUBLISH');
    expect(r.text).not.toContain("Don't want reminders");
  });

  it('renders an update', () => {
    const r = renderEventEmail(claimed({ kind: 'update', sequence: 1 }), opts);

    expect(r.subject).toBe('Updated: Fish Fry');
    expect(r.text).toContain(
      'The details have changed — the new details are below.',
    );
    expect(r.ics?.contentType).toContain('method=PUBLISH');
    expect(decode(r.ics!.content)).toContain('SEQUENCE:1');
  });

  it('renders a cancel', () => {
    const r = renderEventEmail(claimed({ kind: 'cancel' }), opts);

    expect(r.subject).toBe('Cancelled: Fish Fry');
    expect(r.text).toContain(
      'This event has been cancelled. No action is needed.',
    );
    expect(r.ics?.contentType).toBe(
      'text/calendar; method=CANCEL; charset=UTF-8',
    );
    expect(decode(r.ics!.content)).toContain('STATUS:CANCELLED');
  });

  it.each(['confirmation', 'update'] as const)(
    'renders a %s for an already-cancelled event as a cancel',
    (kind) => {
      const r = renderEventEmail(
        claimed({ kind, eventStatus: 'cancelled' }),
        opts,
      );
      const ics = decode(r.ics!.content);

      expect(r.subject).toBe('Cancelled: Fish Fry');
      expect(r.text).toContain('This event has been cancelled.');
      expect(r.text).not.toContain('signed up for');
      expect(r.ics?.contentType).toContain('method=CANCEL');
      expect(ics).toContain('METHOD:CANCEL');
      expect(ics).toContain('STATUS:CANCELLED');
    },
  );

  it('renders a reminder with no calendar file and an opt-out footer', () => {
    const r = renderEventEmail(claimed({ kind: 'reminder' }), opts);

    expect(r.subject).toBe('Reminder: Fish Fry tomorrow');
    expect(r.ics).toBeUndefined();
    expect(r.text).toContain(
      "Don't want reminders? Turn them off on My volunteering: https://portal.example.org/home/volunteering",
    );
    expect(r.html).toContain(
      'href="https://portal.example.org/home/volunteering"',
    );
  });

  it('escapes HTML in the title, name and location', () => {
    const r = renderEventEmail(
      claimed({
        title: '<script>alert(1)</script>',
        firstName: '<b>Nick</b>',
        location: 'A & B "Hall"',
      }),
      opts,
    );

    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<b>');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).toContain('A &amp; B &quot;Hall&quot;');
  });

  it('shows the shift label and omits Where when there is no location', () => {
    const r = renderEventEmail(
      claimed({ shiftLabel: 'Setup', location: null }),
      opts,
    );

    expect(r.text).toContain('What: Fish Fry — Setup');
    expect(r.text).not.toContain('Where:');
  });
});
