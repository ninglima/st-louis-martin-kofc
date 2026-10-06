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
import type { ClaimedNotice } from '../types';

type Client = SupabaseClient<Database>;

export const INVALID_EMAIL_ERROR = 'invalid email address';

export interface SendClaimedResult {
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

/**
 * Live-mode send path shared by the daily job and the manual test send.
 * Call with the SERVICE-ROLE client so notice status updates are allowed.
 */
export async function sendClaimedNotices({
  client,
  config,
  claimed,
  fetchImpl = fetch,
}: {
  client: Client;
  config: NoticesConfig;
  claimed: ClaimedNotice[];
  fetchImpl?: typeof fetch;
}): Promise<SendClaimedResult> {
  const result: SendClaimedResult = {
    sent: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };

  if (claimed.length === 0) {
    return result;
  }

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
    emails.length > 0 ? await sendBatch(config.apiKey, emails, fetchImpl) : [];
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

  return result;
}
