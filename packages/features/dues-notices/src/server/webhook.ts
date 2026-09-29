import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { verifySvixSignature } from '../svix';

type Client = SupabaseClient<Database>;

const TRACKED = new Set([
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'suppressed',
  'failed',
  'opened',
  'clicked',
]);

type ResendTag = { name?: string; value?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resend echoes back the tags the job attached when it sent the email
 * (job.ts), but the payload shape for that isn't pinned down: it has been
 * seen both as an array of `{ name, value }` pairs and as a plain
 * `{ notice_id: value }` object. Both are accepted here.
 */
function noticeIdFromTags(tags: unknown): string | null {
  if (Array.isArray(tags)) {
    for (const tag of tags as ResendTag[]) {
      if (tag && tag.name === 'notice_id' && typeof tag.value === 'string') {
        return tag.value;
      }
    }

    return null;
  }

  if (tags && typeof tags === 'object') {
    const value = (tags as Record<string, unknown>).notice_id;
    return typeof value === 'string' ? value : null;
  }

  return null;
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; tags?: unknown };
}

/** Only Resend can produce a validly-signed body, so a parse failure here
 * means a malformed payload rather than an attack. Returning null (400)
 * rather than throwing (500) keeps a permanently bad payload from being
 * retried forever. */
function parseEvent(body: string): ResendEvent | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object'
      ? (parsed as ResendEvent)
      : null;
  } catch {
    return null;
  }
}

/** Resend webhook: verify, match the email to a dues notice, store the event
 * once. Anything that isn't a dues notice is acknowledged and ignored.
 * Call with the SERVICE-ROLE client. */
export async function handleResendWebhook({
  client,
  secret,
  headers,
  body,
  nowSeconds,
}: {
  client: Client;
  secret: string;
  headers: Headers;
  body: string;
  nowSeconds: number;
}): Promise<{ status: number; stored: boolean }> {
  if (!secret) {
    // Svix retries with backoff, so once the secret is configured, events
    // queued while it was missing still get delivered -- but until then,
    // every delivery fails the same way, so this needs to be visible.
    console.error('RESEND_WEBHOOK_SECRET is not configured');
    return { status: 500, stored: false };
  }

  const id = headers.get('svix-id') ?? '';
  const valid = verifySvixSignature({
    secret,
    id,
    timestamp: headers.get('svix-timestamp') ?? '',
    signature: headers.get('svix-signature') ?? '',
    body,
    nowSeconds,
  });

  if (!valid) return { status: 400, stored: false };

  const event = parseEvent(body);

  if (!event) return { status: 400, stored: false };

  const type = (event.type ?? '').replace(/^email\./, '');

  if (!TRACKED.has(type)) return { status: 200, stored: false };

  const emailId = event.data?.email_id;
  // Only a well-formed UUID can be one of our notice ids; anything else
  // (another sender reusing the tag name) would make Postgres reject the
  // lookup with 22P02, so it falls back to matching the email id instead.
  const rawTag = noticeIdFromTags(event.data?.tags);
  const tagNoticeId = rawTag && UUID.test(rawTag) ? rawTag : null;

  let noticeId: string | null = null;

  // Match by the notice_id tag first: the job attaches it before sending, so
  // it's there from the very first event, whereas resend_email_id is only
  // written after the send call returns. Matching resend_email_id alone
  // would miss any event that arrives in that window.
  if (tagNoticeId) {
    const { data, error } = await client
      .from('dues_notices')
      .select('id')
      .eq('id', tagNoticeId)
      .maybeSingle();

    if (error) throw error;
    if (data) noticeId = data.id;
  }

  if (!noticeId) {
    if (!emailId) return { status: 200, stored: false };

    const { data, error } = await client
      .from('dues_notices')
      .select('id')
      .eq('resend_email_id', emailId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { status: 200, stored: false };

    noticeId = data.id;
  }

  const { error } = await client.from('dues_notice_events').upsert(
    {
      notice_id: noticeId,
      type,
      occurred_at:
        event.created_at ?? new Date(nowSeconds * 1000).toISOString(),
      svix_id: id,
      payload: event as never,
    },
    { onConflict: 'svix_id', ignoreDuplicates: true },
  );

  if (error) throw error;

  return { status: 200, stored: true };
}
