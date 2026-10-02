import type { SupabaseClient } from '@supabase/supabase-js';

import {
  handleResendWebhookWithSinks,
  type WebhookSink,
} from '@kit/email/webhook';
import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claims events for dues notices (by notice_id tag, else resend_email_id).
 * Returns null for anything else, e.g. event emails. */
export function duesNoticesSink(client: Client): WebhookSink {
  return {
    async match({ tags, emailId }) {
      // Only a well-formed UUID can be one of our notice ids; anything else
      // (another sender reusing the tag name) would make Postgres reject the
      // lookup with 22P02, so it falls back to matching the email id instead.
      const rawTag = tags.notice_id;
      const tagNoticeId = rawTag && UUID.test(rawTag) ? rawTag : null;

      // Match by the notice_id tag first: the job attaches it before sending,
      // so it's there from the very first event, whereas resend_email_id is
      // only written after the send call returns. Matching resend_email_id
      // alone would miss any event that arrives in that window.
      if (tagNoticeId) {
        const { data, error } = await client
          .from('dues_notices')
          .select('id')
          .eq('id', tagNoticeId)
          .maybeSingle();

        if (error) throw error;
        if (data) return { id: data.id };
      }

      if (!emailId) return null;

      const { data, error } = await client
        .from('dues_notices')
        .select('id')
        .eq('resend_email_id', emailId)
        .maybeSingle();

      if (error) throw error;

      return data ? { id: data.id } : null;
    },

    async store({ id, type, occurredAt, svixId, payload }) {
      const { error } = await client.from('dues_notice_events').upsert(
        {
          notice_id: id,
          type,
          occurred_at: occurredAt,
          svix_id: svixId,
          payload: payload as never,
        },
        { onConflict: 'svix_id', ignoreDuplicates: true },
      );

      if (error) throw error;
    },
  };
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
  return handleResendWebhookWithSinks({
    secret,
    headers,
    body,
    nowSeconds,
    sinks: [duesNoticesSink(client)],
  });
}
