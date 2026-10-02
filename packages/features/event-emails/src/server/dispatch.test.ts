import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { dispatchEventEmails } from './dispatch';
import { fakeClient, liveConfig, row } from './fakes';

const ok = (id = 'rid') =>
  new Response(JSON.stringify({ id, data: [{ id }, { id: `${id}2` }] }), {
    status: 200,
  });
const status = (code: number, message = 'nope') =>
  new Response(JSON.stringify({ message }), { status: code });

const NOW = Date.parse('2026-11-01T12:00:00Z');
const base = {
  now: () => NOW,
  sleep: async () => {},
};

describe('dispatchEventEmails', () => {
  it('does nothing when off', async () => {
    const { client, rpc } = fakeClient();
    const fetchImpl = vi.fn();
    const r = await dispatchEventEmails({
      client,
      config: { ...liveConfig, mode: 'off' },
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(r).toEqual({
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      error: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses live without its settings, without any rpc', async () => {
    const { client, rpc } = fakeClient();
    const r = await dispatchEventEmails({
      client,
      config: { ...liveConfig, missingForLive: ['RESEND_API_KEY'] },
      ...base,
    });
    expect(r.error).toContain('RESEND_API_KEY');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('dry-run counts skipped and never fetches or records a send', async () => {
    const { client, rpc, updates } = fakeClient({
      pages: [
        [
          row({ email_id: 'a', mode: 'dry_run' }),
          row({ email_id: 'b', mode: 'dry_run' }),
        ],
      ],
    });
    const fetchImpl = vi.fn();
    const r = await dispatchEventEmails({
      client,
      config: { ...liveConfig, mode: 'dry_run' },
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(r).toMatchObject({ candidates: 2, skipped: 2, sent: 0, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('event_emails_claim', {
      p_mode: 'dry_run',
      p_limit: 50,
    });
  });

  it('sends a confirmation singly with the idempotency key, attachment and tag', async () => {
    const { client, updates } = fakeClient({ pages: [[row()]] });
    const fetchImpl = vi.fn(async () => ok('rid-1'));
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(r).toMatchObject({ candidates: 1, sent: 1, failed: 0, error: null });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'event-email/e1',
    );
    const body = JSON.parse(init.body as string);
    expect(body.tags).toEqual([{ name: 'event_email_id', value: 'e1' }]);
    expect(body.reply_to).toBe('fs@x.org');
    expect(body.from).toBe(liveConfig.from);
    expect(body.attachments[0]).toMatchObject({
      filename: 'event.ics',
      content_type: expect.stringContaining('text/calendar'),
    });
    expect(
      Buffer.from(body.attachments[0].content, 'base64').toString(),
    ).toContain('BEGIN:VCALENDAR');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: 'e1',
      values: {
        status: 'sent',
        resend_email_id: 'rid-1',
        error: null,
        sent_at: '2026-11-01T12:00:00.000Z',
      },
    });
  });

  it('sends reminders in one batch call', async () => {
    const { client, updates } = fakeClient({
      pages: [
        [
          row({ email_id: 'r1', kind: 'reminder' }),
          row({ email_id: 'r2', kind: 'reminder', email: 'b@example.org' }),
        ],
      ],
    });
    const fetchImpl = vi.fn(async () => ok('rid'));
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(
      'https://api.resend.com/emails/batch',
    );
    expect(r.sent).toBe(2);
    expect(updates.map((u) => [u.id, u.values.resend_email_id])).toEqual([
      ['r1', 'rid'],
      ['r2', 'rid2'],
    ]);
  });

  it('marks a reminder for a cancelled event superseded without sending', async () => {
    const { client, updates } = fakeClient({
      pages: [
        [row({ email_id: 'r1', kind: 'reminder', event_status: 'cancelled' })],
      ],
    });
    const fetchImpl = vi.fn();
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates).toEqual([{ id: 'r1', values: { status: 'superseded' } }]);
    expect(r).toMatchObject({ skipped: 1, sent: 0, failed: 0 });
  });

  it('waits gapMs between single sends only', async () => {
    const { client } = fakeClient({
      pages: [
        [
          row({ email_id: 'a' }),
          row({ email_id: 'b', kind: 'update' }),
          row({ email_id: 'c', kind: 'cancel' }),
        ],
      ],
    });
    const sleep = vi.fn(async () => {});
    await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => ok()) as never,
      now: base.now,
      sleep,
      gapMs: 600,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(600);
  });

  it('429 on attempt 1 is failed with 15 minute backoff', async () => {
    const { client, updates } = fakeClient({
      pages: [[row()]],
      attempts: { e1: 1 },
    });
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => status(429, 'slow down')) as never,
      ...base,
    });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(updates[0]!.values).toMatchObject({
      status: 'failed',
      next_attempt_at: new Date(NOW + 15 * 60_000).toISOString(),
    });
    expect(String(updates[0]!.values.error)).toContain('429');
  });

  it('backs off 30 minutes on attempt 2, and the 3rd retryable failure is dead', async () => {
    const two = fakeClient({ pages: [[row()]], attempts: { e1: 2 } });
    await dispatchEventEmails({
      client: two.client,
      config: liveConfig,
      fetchImpl: (async () => status(503)) as never,
      ...base,
    });
    expect(two.updates[0]!.values).toMatchObject({
      status: 'failed',
      next_attempt_at: new Date(NOW + 30 * 60_000).toISOString(),
    });

    const three = fakeClient({ pages: [[row()]], attempts: { e1: 3 } });
    await dispatchEventEmails({
      client: three.client,
      config: liveConfig,
      fetchImpl: (async () => status(503)) as never,
      ...base,
    });
    expect(three.updates[0]!.values.status).toBe('dead');
  });

  it('a 422 is dead on the first attempt', async () => {
    const { client, updates } = fakeClient({
      pages: [[row()]],
      attempts: { e1: 1 },
    });
    await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => status(422, 'bad')) as never,
      ...base,
    });
    expect(updates[0]!.values).toMatchObject({ status: 'dead' });
    expect(updates[0]!.values.next_attempt_at).toBeUndefined();
  });

  it('a retryable batch failure for reminders is failed', async () => {
    const { client, updates } = fakeClient({
      pages: [[row({ email_id: 'r1', kind: 'reminder' })]],
    });
    await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => status(500)) as never,
      ...base,
    });
    expect(updates[0]!.values.status).toBe('failed');
  });

  it('an invalid address is dead with no fetch', async () => {
    const { client, updates } = fakeClient({
      pages: [[row({ email: 'not-an-email' })]],
    });
    const fetchImpl = vi.fn();
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: fetchImpl as never,
      ...base,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      id: 'e1',
      values: { status: 'dead', error: 'invalid email address' },
    });
    expect(r.failed).toBe(1);
  });

  it('keeps claiming until a page is empty', async () => {
    const { client, rpc } = fakeClient({
      pages: [[row({ email_id: 'a' })], [row({ email_id: 'b' })]],
    });
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => ok()) as never,
      ...base,
    });
    expect(r.candidates).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('stops claiming once the budget is spent', async () => {
    const { client, rpc } = fakeClient({
      pages: [[row({ email_id: 'a' })], [row({ email_id: 'b' })]],
    });
    let t = NOW;
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => ok()) as never,
      budgetMs: 1000,
      sleep: async () => {},
      now: () => {
        const v = t;
        t += 600;
        return v;
      },
    });
    expect(rpc.mock.calls.length).toBeLessThan(3);
    expect(r.candidates).toBeLessThan(2);
  });

  it('puts an rpc error in error without throwing', async () => {
    const { client } = fakeClient({ claimError: { message: 'boom' } });
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      ...base,
    });
    expect(r.error).toBe('boom');
  });

  it('reports a write error but still counts the send', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeClient({
      pages: [[row()]],
      updateError: { message: 'denied' },
    });
    const r = await dispatchEventEmails({
      client,
      config: liveConfig,
      fetchImpl: (async () => ok()) as never,
      ...base,
    });
    expect(r.sent).toBe(1);
    expect(r.error).toContain('denied');
    spy.mockRestore();
  });
});
