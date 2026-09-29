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
  'opened',
  'clicked',
]);

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
  if (!secret) return { status: 500, stored: false };

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

  const event = JSON.parse(body) as {
    type?: string;
    created_at?: string;
    data?: { email_id?: string };
  };
  const type = (event.type ?? '').replace(/^email\./, '');
  const emailId = event.data?.email_id;

  if (!TRACKED.has(type) || !emailId) return { status: 200, stored: false };

  const { data: notice } = await client
    .from('dues_notices')
    .select('id')
    .eq('resend_email_id', emailId)
    .maybeSingle();

  if (!notice) return { status: 200, stored: false };

  const { error } = await client.from('dues_notice_events').upsert(
    {
      notice_id: notice.id,
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
