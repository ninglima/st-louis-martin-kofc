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

function fakeClient({
  rows = [] as { id: string; resend_email_id?: string | null }[],
  lookupError = null as string | null,
} = {}) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (col: 'id' | 'resend_email_id', value: string) => ({
          maybeSingle: async () => {
            if (lookupError)
              return { data: null, error: new Error(lookupError) };
            const row = rows.find((r) =>
              col === 'id' ? r.id === value : r.resend_email_id === value,
            );
            return { data: row ? { id: row.id } : null, error: null };
          },
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
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });
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

  it('stores an event for a dues notice, matched by resend_email_id, keyed by the svix id', async () => {
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });
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
    const { client, inserted } = fakeClient();
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
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });
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

  it('refuses when no secret is configured, and logs it', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { client } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });
    const result = await handleResendWebhook({
      client,
      secret: '',
      headers: signed(event),
      body: event,
      nowSeconds: now,
    });
    expect(result.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('matches an early event by its notice_id tag, before resend_email_id is stored (array tag shape)', async () => {
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: null }],
    });
    const tagged = JSON.stringify({
      type: 'email.sent',
      created_at: '2026-10-01T12:00:00Z',
      data: { email_id: 're_1', tags: [{ name: 'notice_id', value: 'n1' }] },
    });
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(tagged),
        body: tagged,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: true,
    });
    expect(inserted[0]).toMatchObject({ notice_id: 'n1', type: 'sent' });
  });

  it('matches by the notice_id tag given as an object', async () => {
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: null }],
    });
    const tagged = JSON.stringify({
      type: 'email.sent',
      created_at: '2026-10-01T12:00:00Z',
      data: { email_id: 're_1', tags: { notice_id: 'n1' } },
    });
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(tagged),
        body: tagged,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: true,
    });
    expect(inserted[0]).toMatchObject({ notice_id: 'n1' });
  });

  it('falls back to the email id when the notice_id tag matches no row', async () => {
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });
    const tagged = JSON.stringify({
      type: 'email.opened',
      created_at: '2026-10-01T12:00:00Z',
      data: {
        email_id: 're_1',
        tags: [{ name: 'notice_id', value: 'unknown' }],
      },
    });
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(tagged),
        body: tagged,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 200,
      stored: true,
    });
    expect(inserted[0]).toMatchObject({ notice_id: 'n1' });
  });

  it('throws on a database error during the notice lookup, instead of treating it as unknown', async () => {
    const { client } = fakeClient({ lookupError: 'connection reset' });
    await expect(
      handleResendWebhook({
        client,
        secret,
        headers: signed(event),
        body: event,
        nowSeconds: now,
      }),
    ).rejects.toThrow('connection reset');
  });

  it('returns 400 without storing when the body is not a JSON object, even with a valid signature', async () => {
    const { client, inserted } = fakeClient({
      rows: [{ id: 'n1', resend_email_id: 're_1' }],
    });

    const badJson = 'not json';
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(badJson),
        body: badJson,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 400,
      stored: false,
    });

    const nonObject = '"just a string"';
    expect(
      await handleResendWebhook({
        client,
        secret,
        headers: signed(nonObject),
        body: nonObject,
        nowSeconds: now,
      }),
    ).toEqual({
      status: 400,
      stored: false,
    });

    expect(inserted).toHaveLength(0);
  });
});
