import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { handleResendWebhook } from './webhook';

// At least 16 bytes: svix.ts rejects a shorter decoded key outright.
const rawKey = Buffer.from('webhook-signing-key');
const secret = `whsec_${rawKey.toString('base64')}`;
const now = 1790000000;

function signed(body: string, id = 'msg_1') {
  const signature = `v1,${createHmac('sha256', rawKey).update(`${id}.${now}.${body}`).digest('base64')}`;
  return new Headers({
    'svix-id': id,
    'svix-timestamp': String(now),
    'svix-signature': signature,
  });
}

function fakeClient(noticeId: string | null) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: noticeId ? { id: noticeId } : null,
            error: null,
          }),
        }),
      }),
      upsert: async (values: Record<string, unknown>, opts: unknown) => {
        if (table === 'dues_notice_events') inserted.push({ ...values, opts });
        return { error: null };
      },
    }),
  };
  return { client: client as never, inserted };
}

const event = JSON.stringify({
  type: 'email.opened',
  created_at: '2026-10-01T12:00:00Z',
  data: { email_id: 're_1' },
});

describe('handleResendWebhook', () => {
  it('rejects a bad signature', async () => {
    const { client, inserted } = fakeClient('n1');
    const headers = signed(event);
    headers.set('svix-signature', 'v1,Zm9v');
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers,
        body: event,
        nowSeconds: now,
      }),
    ).toEqual({ status: 400, stored: false });
    expect(inserted).toHaveLength(0);
  });

  it('stores an event for a dues notice, keyed by the svix id', async () => {
    const { client, inserted } = fakeClient('n1');
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(event),
        body: event,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: true,
    });
    expect(inserted[0]).toMatchObject({
      notice_id: 'n1',
      type: 'opened',
      occurred_at: '2026-10-01T12:00:00Z',
      svix_id: 'msg_1',
      opts: { onConflict: 'svix_id', ignoreDuplicates: true },
    });
  });

  it('acknowledges emails that are not dues notices without storing them', async () => {
    const { client, inserted } = fakeClient(null);
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(event),
        body: event,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: false,
    });
    expect(inserted).toHaveLength(0);
  });

  it('acknowledges event types it does not track', async () => {
    const { client, inserted } = fakeClient('n1');
    const other = JSON.stringify({
      type: 'contact.created',
      created_at: '2026-10-01T12:00:00Z',
      data: {},
    });
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(other),
        body: other,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: false,
    });
    expect(inserted).toHaveLength(0);
  });

  it('refuses when no secret is configured', async () => {
    const { client } = fakeClient('n1');
    expect(
      (
        await handleResendWebhook({
          client,
          secret: '',
          headers: signed(event),
          body: event,
          nowSeconds: now,
        })
      ).status,
    ).toBe(500);
  });
});
