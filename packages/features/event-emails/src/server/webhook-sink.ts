import type { SupabaseClient } from '@supabase/supabase-js';

import type { WebhookSink } from '@kit/email/webhook';
import type { Database } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claims Resend events for event emails: by the event_email_id tag (set
 * before sending, so present from the first event), else by resend_email_id.
 * Returns null for anything else, e.g. dues notices. Use the SERVICE-ROLE
 * client. */
export function eventEmailsSink(client: Client): WebhookSink {
  return {
    async match({ tags, emailId }) {
      // Only a well-formed UUID can be an outbox id; anything else would make
      // Postgres reject the lookup with 22P02.
      const rawTag = tags.event_email_id;
      const tagId = rawTag && UUID.test(rawTag) ? rawTag : null;

      if (tagId) {
        const { data, error } = await client
          .from('event_emails')
          .select('id')
          .eq('id', tagId)
          .maybeSingle();

        if (error) throw error;
        if (data) return { id: data.id };
      }

      if (!emailId) return null;

      const { data, error } = await client
        .from('event_emails')
        .select('id')
        .eq('resend_email_id', emailId)
        .maybeSingle();

      if (error) throw error;

      return data ? { id: data.id } : null;
    },

    async store({ id, type, occurredAt, svixId, payload }) {
      const { error } = await client.from('event_email_events').upsert(
        {
          email_id: id,
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
