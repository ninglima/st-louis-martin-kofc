import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { handleResendWebhookWithSinks } from '@kit/email/webhook';
import { duesNoticesSink } from '@kit/dues-notices/server/webhook';

import { eventEmailsSink } from './webhook-sink';

const rawKey = Buffer.from('webhook-signing-key');
const secret = `whsec_${rawKey.toString('base64')}`;
const now = 1790000000;
const EVENT_EMAIL_ID = '7a1c2d3e-4a5b-4c6d-8e7f-901234567890';
const NOTICE_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';

function signed(body: string, id = 'msg_1') {
  const signature = `v1,${createHmac('sha256', rawKey).update(`${id}.${now}.${body}`).digest('base64')}`;
  return new Headers({
    'svix-id': id,
    'svix-timestamp': String(now),
    'svix-signature': signature,
  });
}

type Row = { id: string; resend_email_id?: string | null };

function fakeClient({ notices = [] as Row[], emails = [] as Row[] } = {}) {
  const stored: { table: string; values: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  const tables: Record<string, Row[]> = {
    dues_notices: notices,
    event_emails: emails,
  };
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (col: 'id' | 'resend_email_id', value: string) => ({
          maybeSingle: async () => {
            const row = (tables[table] ?? []).find((r) => r[col] === value);
            return { data: row ? { id: row.id } : null, error: null };
          },
        }),
      }),
      upsert: async (values: Record<string, unknown>) => {
        const svix = values.svix_id as string;
        if (!seen.has(`${table}:${svix}`)) {
          seen.add(`${table}:${svix}`);
          stored.push({ table, values });
        }
        return { error: null };
      },
    }),
  };
  return { client: client as never, stored };
}

function run(client: never, body: string, svixId = 'msg_1') {
  return handleResendWebhookWithSinks({
    secret,
    headers: signed(body, svixId),
    body,
    nowSeconds: now,
    sinks: [duesNoticesSink(client), eventEmailsSink(client)],
  });
}

const payload = (data: Record<string, unknown>) =>
  JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-10-01T12:00:00Z',
    data,
  });

describe('event email webhook routing', () => {
  it('routes the event_email_id tag to the event sink', async () => {
    const { client, stored } = fakeClient({ emails: [{ id: EVENT_EMAIL_ID }] });
    const body = payload({
      email_id: 're_1',
      tags: [{ name: 'event_email_id', value: EVENT_EMAIL_ID }],
    });

    expect(await run(client, body)).toEqual({ status: 200, stored: true });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      table: 'event_email_events',
      values: {
        email_id: EVENT_EMAIL_ID,
        type: 'delivered',
        svix_id: 'msg_1',
      },
    });
  });

  it('keeps a dues notice_id on the dues sink', async () => {
    const { client, stored } = fakeClient({
      notices: [{ id: NOTICE_ID }],
      emails: [{ id: EVENT_EMAIL_ID }],
    });
    const body = payload({
      email_id: 're_1',
      tags: { notice_id: NOTICE_ID },
    });

    expect(await run(client, body)).toEqual({ status: 200, stored: true });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      table: 'dues_notice_events',
      values: { notice_id: NOTICE_ID },
    });
  });

  it('finds an untagged email by resend_email_id in event_emails', async () => {
    const { client, stored } = fakeClient({
      emails: [{ id: EVENT_EMAIL_ID, resend_email_id: 're_9' }],
    });

    expect(await run(client, payload({ email_id: 're_9' }))).toEqual({
      status: 200,
      stored: true,
    });
    expect(stored[0]).toMatchObject({
      table: 'event_email_events',
      values: { email_id: EVENT_EMAIL_ID },
    });
  });

  it('acknowledges an unknown id without storing it', async () => {
    const { client, stored } = fakeClient({
      emails: [{ id: EVENT_EMAIL_ID, resend_email_id: 're_9' }],
    });
    const body = payload({
      email_id: 're_unknown',
      tags: { event_email_id: '00000000-0000-4000-8000-000000000000' },
    });

    expect(await run(client, body)).toEqual({ status: 200, stored: false });
    expect(stored).toHaveLength(0);
  });

  it('stores a replayed svix id once', async () => {
    const { client, stored } = fakeClient({ emails: [{ id: EVENT_EMAIL_ID }] });
    const body = payload({
      email_id: 're_1',
      tags: { event_email_id: EVENT_EMAIL_ID },
    });

    await run(client, body);
    await run(client, body);
    expect(stored).toHaveLength(1);
  });

  it('upserts on svix_id ignoring duplicates', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const client = { from: () => ({ upsert }) } as never;

    await eventEmailsSink(client).store({
      id: EVENT_EMAIL_ID,
      type: 'sent',
      occurredAt: '2026-10-01T12:00:00Z',
      svixId: 'msg_1',
      payload: {},
    });
    expect(upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: 'svix_id',
      ignoreDuplicates: true,
    });
  });
});
