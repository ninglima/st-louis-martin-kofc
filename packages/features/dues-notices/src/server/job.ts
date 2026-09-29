import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { NoticesConfig } from '../config';
import { sendBatch } from '../resend';
import { renderNotice } from '../templates';
import type { ClaimedNotice, NoticeKind, NoticesMode } from '../types';

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
  await client.from('dues_notice_runs').insert({
    mode: result.mode,
    candidates: result.candidates,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    error: result.error,
  });
}

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
    email: r.email as string,
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

  const emails = claimed.map((n) => {
    const rendered = renderNotice(n, config.siteUrl);
    return {
      from: config.from,
      to: n.email,
      replyTo: config.replyTo || undefined,
      ...rendered,
      tags: [
        { name: 'notice_id', value: n.noticeId },
        { name: 'kind', value: n.kind },
      ],
    };
  });

  const sent = await sendBatch(config.apiKey, emails, fetchImpl);

  for (const [i, outcome] of sent.entries()) {
    const notice = claimed[i]!;

    if (outcome.ok) {
      result.sent += 1;
      await client
        .from('dues_notices')
        .update({
          status: 'sent',
          resend_email_id: outcome.id,
          sent_at: new Date().toISOString(),
        })
        .eq('id', notice.noticeId);
    } else {
      result.failed += 1;
      await client
        .from('dues_notices')
        .update({ status: 'failed', error: outcome.error })
        .eq('id', notice.noticeId);
    }
  }

  await recordRun(client, result);
  return result;
}
