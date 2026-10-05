import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isEmailAllowlisted,
  NOT_ON_ALLOWLIST_ERROR,
} from '@kit/email/allowlist';
import { isPlausibleEmail } from '@kit/email/email-format';
import type { Database } from '@kit/supabase/database';

import type { NoticesConfig } from '../config';
import { type SendResult, sendBatch } from '../resend';
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

export { isPlausibleEmail };

export const INVALID_EMAIL_ERROR = 'invalid email address';

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
    // Invalid addresses never reach Resend: they are marked failed on their
    // own and the rest of the batch still goes out. Allowlist misses are
    // marked failed with a fixed error and counted as skipped so a later
    // job cannot leave them stuck in pending (claim only returns inserts).
    const blocked: ClaimedNotice[] = [];
    const sendable = claimed.filter((n) => {
      if (!isPlausibleEmail(n.email)) return false;
      if (!isEmailAllowlisted(n.email, config.allowlist)) {
        blocked.push(n);
        return false;
      }
      return true;
    });

    for (const notice of blocked) {
      const { error: updateError } = await client
        .from('dues_notices')
        .update({ status: 'failed', error: NOT_ON_ALLOWLIST_ERROR })
        .eq('id', notice.noticeId);

      result.skipped += 1;

      if (updateError) {
        console.error(
          `Dues notice ${notice.noticeId} was blocked by EMAIL_ALLOWLIST but could not be recorded:`,
          updateError,
        );
      }
    }

    const emails = sendable.map((n) => {
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

    const sentResults =
      emails.length > 0
        ? await sendBatch(config.apiKey, emails, fetchImpl)
        : [];
    const byNotice = new Map<string, SendResult>(
      sendable.map((n, i) => [n.noticeId, sentResults[i]!]),
    );
    // Allowlist-blocked notices already have a terminal status; do not
    // overwrite them with INVALID_EMAIL_ERROR below.
    const blockedIds = new Set(blocked.map((n) => n.noticeId));
    const toRecord = claimed.filter((n) => !blockedIds.has(n.noticeId));
    const sent: { notice: ClaimedNotice; outcome: SendResult }[] = toRecord.map(
      (n) => ({
        notice: n,
        outcome:
          byNotice.get(n.noticeId) ?? {
            ok: false as const,
            error: INVALID_EMAIL_ERROR,
          },
      }),
    );

    // Updated in parallel, after the whole batch: sequentially, one round
    // trip per notice, the update for the k-th notice lands well after
    // Resend's first webhook events for it can already have arrived, and
    // those events would then find no matching row. The webhook also
    // matches on the notice_id tag it can see from the moment the email is
    // sent, which closes the remaining gap.
    const outcomes = await Promise.all(
      sent.map(async ({ notice, outcome }) => {
        if (outcome.ok) {
          const { error: updateError } = await client
            .from('dues_notices')
            .update({
              status: 'sent',
              resend_email_id: outcome.id,
              sent_at: new Date().toISOString(),
            })
            .eq('id', notice.noticeId);

          return { ok: true as const, notice, outcome, updateError };
        }

        const { error: updateError } = await client
          .from('dues_notices')
          .update({ status: 'failed', error: outcome.error })
          .eq('id', notice.noticeId);

        return { ok: false as const, notice, outcome, updateError };
      }),
    );

    const writeErrors: string[] = [];

    for (const o of outcomes) {
      if (o.ok) {
        result.sent += 1;
      } else {
        result.failed += 1;
      }

      if (o.updateError) {
        // The Resend id (when there is one) is the only way to reconcile
        // this notice by hand later, so it goes in the log even though it
        // didn't make it into the database. Never the API key: it never
        // appears here in the first place.
        console.error(
          o.ok
            ? `Dues notice ${o.notice.noticeId} was sent (Resend id ${o.outcome.id}) but could not be recorded:`
            : `Dues notice ${o.notice.noticeId} failed to send and could not be recorded:`,
          o.updateError,
        );
        writeErrors.push(o.updateError.message);
      }
    }

    if (writeErrors.length > 0) {
      result.error = `Could not record ${writeErrors.length} notice outcome(s): ${writeErrors[0]}`;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await recordRun(client, result);
    throw e;
  }

  await recordRun(client, result);
  return result;
}
