import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { type OutgoingEmail, sendEmail } from './resend';

const email: OutgoingEmail = {
  from: 'KofC <a@example.org>',
  to: 'm@example.com',
  replyTo: 'r@example.org',
  subject: 's',
  html: 'h',
  text: 't',
  tags: [{ name: 'k', value: 'v' }],
  attachments: [
    { filename: 'a.ics', content: 'QkVHSU4=', contentType: 'text/calendar' },
  ],
};

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('sendEmail', () => {
  it('posts the payload with attachments and the idempotency header', async () => {
    const fetchImpl = respond(200, { id: 're_1' });
    const result = await sendEmail('re_key', email, {
      idempotencyKey: 'idem-1',
      fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({ ok: true, id: 're_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'KofC <a@example.org>',
      to: ['m@example.com'],
      reply_to: 'r@example.org',
      subject: 's',
      html: 'h',
      text: 't',
      tags: [{ name: 'k', value: 'v' }],
      attachments: [
        {
          filename: 'a.ics',
          content: 'QkVHSU4=',
          content_type: 'text/calendar',
        },
      ],
    });
  });

  it('omits the idempotency header and attachments when absent', async () => {
    const fetchImpl = respond(200, { id: 're_2' });
    await sendEmail(
      'k',
      { ...email, attachments: undefined },
      {
        fetchImpl: fetchImpl as never,
      },
    );
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('attachments');
  });

  it.each([429, 500, 503])('treats %i as retryable', async (status) => {
    const result = await sendEmail('k', email, {
      fetchImpl: respond(status, { message: 'nope' }) as never,
    });
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it('treats other 4xx as permanent', async () => {
    const result = await sendEmail('k', email, {
      fetchImpl: respond(422, { message: 'bad address' }) as never,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Resend 422: bad address',
      retryable: false,
    });
  });

  it('treats a thrown fetch as retryable and never throws', async () => {
    const result = await sendEmail('k', email, {
      fetchImpl: vi.fn(async () => {
        throw new Error('fetch failed');
      }) as never,
    });
    expect(result).toEqual({
      ok: false,
      error: 'fetch failed',
      retryable: true,
    });
  });

  it('redacts the api key in thrown and API errors', async () => {
    const thrown = await sendEmail('re_secret', email, {
      fetchImpl: vi.fn(async () => {
        throw new Error('bad header Bearer re_secret');
      }) as never,
    });
    const api = await sendEmail('re_secret', email, {
      fetchImpl: respond(401, { message: 'key re_secret invalid' }) as never,
    });
    for (const r of [thrown, api]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toContain('re_secret');
        expect(r.error).toContain('[redacted]');
      }
    }
  });
});
