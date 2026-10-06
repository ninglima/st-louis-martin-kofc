import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { NoticesConfig } from '../config';
import type { ClaimedNotice, NoticeKind, NoticesMode } from '../types';
import {
  INVALID_EMAIL_ERROR,
  sendClaimedNotices,
} from './send-claimed';

type Client = SupabaseClient<Database>;

export interface JobResult {
  mode: NoticesMode;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

async function recordRun(client: Client, result: JobResult) {
  const { error } = await client.from('dues_notice_runs').insert({
    mode: result.mode,
    candidates: result.candidates,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    error: result.error,
  });

  // Nothing downstream reads this insert's result, so a failure here would
  // otherwise be silent: the job would report success while the "last run"
  // status goes stale.
  if (error) {
    console.error('Could not record the dues notices run:', error);
  }
}

export { isPlausibleEmail } from '@kit/email/email-format';
export { INVALID_EMAIL_ERROR };

/** Runs once a day (and is safe to run again): claims today's notices once
 * each, and in live mode sends them. Call with the SERVICE-ROLE client. */
export async function runDuesNoticesJob({
  client,
  config,
  fetchImpl = fetch,
}: {
  client: Client;
  config: NoticesConfig;
  fetchImpl?: typeof fetch;
}): Promise<JobResult> {
  const result: JobResult = {
    mode: config.mode,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };

  if (config.mode === 'off') {
    await recordRun(client, result);
    return result;
  }

  if (config.mode === 'live' && config.missingForLive.length > 0) {
    result.error = `Live mode needs ${config.missingForLive.join(', ')}`;
    await recordRun(client, result);
    return result;
  }

  const { data, error } = await client.rpc('dues_notices_claim', {
    p_mode: config.mode,
  });

  if (error) {
    result.error = error.message;
    await recordRun(client, result);
    return result;
  }

  const claimed: ClaimedNotice[] = (data ?? []).map((r) => ({
    noticeId: r.notice_id,
    memberId: r.member_id,
    firstName: r.first_name,
    email: r.email,
    kind: r.kind as NoticeKind,
    cycleDate: r.cycle_date,
    firstDues: r.first_dues,
    levelName: r.level_name,
    amountCents: r.amount_cents,
  }));

  result.candidates = claimed.length;

  if (config.mode === 'dry_run' || claimed.length === 0) {
    result.skipped = config.mode === 'dry_run' ? claimed.length : 0;
    await recordRun(client, result);
    return result;
  }

  try {
    const sent = await sendClaimedNotices({
      client,
      config,
      claimed,
      fetchImpl,
    });
    result.sent = sent.sent;
    result.skipped = sent.skipped;
    result.failed = sent.failed;
    result.error = sent.error;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await recordRun(client, result);
    throw e;
  }

  await recordRun(client, result);
  return result;
}

/** Record a manual/admin send against the same runs table the cron uses. */
export async function recordNoticesRun(
  client: Client,
  result: JobResult,
): Promise<void> {
  await recordRun(client, result);
}
