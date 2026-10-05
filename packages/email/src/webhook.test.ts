import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { handleResendWebhookWithSinks, type WebhookSink } from './webhook';

const rawKey = Buffer.from('super-secret-key-for-tests');
const secret = `whsec_${rawKey.toString('base64')}`;
const now = 1790000000;

function request(event: unknown, signWith: Buffer = rawKey) {
  const body = JSON.stringify(event);
  const sig = createHmac('sha256', signWith)
    .update(`msg_1.${now}.${body}`)
    .digest('base64');
  return {
    secret,
    body,
    nowSeconds: now,
    headers: new Headers({
      'svix-id': 'msg_1',
      'svix-timestamp': String(now),
      'svix-signature': `v1,${sig}`,
    }),
  };
}

function sink(matchId: string | null): WebhookSink & {
  match: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
} {
  return {
    match: vi.fn(async () => (matchId ? { id: matchId } : null)),
    store: vi.fn(async () => {}),
  };
}

const delivered = {
  type: 'email.delivered',
  created_at: '2026-10-01T00:00:00Z',
  data: { email_id: 're_1', tags: [{ name: 'notice_id', value: 'n1' }] },
};

describe('handleResendWebhookWithSinks', () => {
  it('routes to the first matching sink only', async () => {
    const a = sink(null);
    const b = sink('row-b');
    const c = sink('row-c');
    const result = await handleResendWebhookWithSinks({
      ...request(delivered),
      sinks: [a, b, c],
    });

    expect(result).toEqual({ status: 200, stored: true });
    expect(a.match).toHaveBeenCalledWith({
      tags: { notice_id: 'n1' },
      emailId: 're_1',
    });
    expect(a.store).not.toHaveBeenCalled();
    expect(b.store).toHaveBeenCalledWith({
      id: 'row-b',
      type: 'delivered',
      occurredAt: '2026-10-01T00:00:00Z',
      svixId: 'msg_1',
      payload: delivered,
    });
    expect(c.match).not.toHaveBeenCalled();
  });

  it('reads tags given as an object', async () => {
    const a = sink('x');
    await handleResendWebhookWithSinks({
      ...request({
        ...delivered,
        data: { email_id: 're_1', tags: { k: 'v' } },
      }),
      sinks: [a],
    });
    expect(a.match).toHaveBeenCalledWith({ tags: { k: 'v' }, emailId: 're_1' });
  });

  it('acknowledges untracked events and unmatched emails without storing', async () => {
    const a = sink(null);
    expect(
      await handleResendWebhookWithSinks({
        ...request({ type: 'email.received', data: {} }),
        sinks: [a],
      }),
    ).toEqual({ status: 200, stored: false });
    expect(a.match).not.toHaveBeenCalled();
    expect(
      await handleResendWebhookWithSinks({ ...request(delivered), sinks: [a] }),
    ).toEqual({ status: 200, stored: false });
  });

  it('rejects a bad signature with 400', async () => {
    const a = sink('x');
    const result = await handleResendWebhookWithSinks({
      ...request(delivered, Buffer.from('another-secret-key-entirely')),
      sinks: [a],
    });
    expect(result).toEqual({ status: 400, stored: false });
    expect(a.match).not.toHaveBeenCalled();
  });
});
