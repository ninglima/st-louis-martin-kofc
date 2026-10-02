import type { SupabaseClient } from '@supabase/supabase-js';

import type { EmailMode } from '@kit/email/mode';
import type { Database } from '@kit/supabase/database';

import type { EventEmailsConfig } from '../config';
import { type DispatchResult, dispatchEventEmails } from './dispatch';

type Client = SupabaseClient<Database>;

export interface JobResult extends DispatchResult {
  mode: EmailMode;
}

async function recordRun(client: Client, result: JobResult) {
  const { error } = await client.from('event_email_runs').insert({
    mode: result.mode,
    candidates: result.candidates,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    error: result.error,
  });

  if (error) {
    console.error('Could not record the event emails run:', error);
  }
}

/** Runs daily (and is safe to run again): queues tomorrow's reminders, then
 * sends or dry-runs everything queued. Call with the SERVICE-ROLE client. */
export async function runEventEmailsJob({
  client,
  config,
  fetchImpl = fetch,
}: {
  client: Client;
  config: EventEmailsConfig;
  fetchImpl?: typeof fetch;
}): Promise<JobResult> {
  let enqueueError: string | null = null;

  if (config.mode !== 'off') {
    const { error } = await client.rpc('event_reminders_enqueue', {
      p_mode: config.mode,
    });

    if (error) enqueueError = error.message;
  }

  const dispatched = await dispatchEventEmails({
    client,
    config,
    fetchImpl,
    budgetMs: 240_000,
  });

  const result: JobResult = {
    mode: config.mode,
    ...dispatched,
    error: dispatched.error ?? enqueueError,
  };

  await recordRun(client, result);
  return result;
}
