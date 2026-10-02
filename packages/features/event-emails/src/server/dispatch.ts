import type { SupabaseClient } from '@supabase/supabase-js';

import { isPlausibleEmail } from '@kit/email/email-format';
import { type OutgoingEmail, sendBatch, sendEmail } from '@kit/email/resend';
import type { Database } from '@kit/supabase/database';

import type { EventEmailsConfig } from '../config';
import { renderEventEmail } from '../templates';
import type { ClaimedEventEmail, EventEmailKind } from '../types';

type Client = SupabaseClient<Database>;

export interface DispatchResult {
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

export const INVALID_EMAIL_ERROR = 'invalid email address';
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 15 * 60_000;
const CLAIM_LIMIT = 50;

type Outcome =
  | { ok: true; id: string }
  | { ok: false; error: string; retryable: boolean };

/** `sendBatch` does not say whether a failure is retryable; its error text
 * starts with the HTTP status when Resend answered. */
function batchOutcome(
  r: { ok: true; id: string } | { ok: false; error: string },
): Outcome {
  if (r.ok) return r;

  const status = /^Resend (\d{3})/.exec(r.error)?.[1];
  const retryable = status ? status === '429' || Number(status) >= 500 : true;

  return { ok: false, error: r.error, retryable };
}

function toClaimed(
  r: Database['public']['Functions']['event_emails_claim']['Returns'][number],
): ClaimedEventEmail {
  return {
    emailId: r.email_id,
    kind: r.kind as EventEmailKind,
    sequence: r.sequence,
    mode: r.mode as ClaimedEventEmail['mode'],
    signupId: r.signup_id,
    eventId: r.event_id,
    firstName: r.first_name,
    email: r.email,
    title: r.title,
    location: r.location,
    description: r.description,
    eventStatus: r.event_status as ClaimedEventEmail['eventStatus'],
    shiftStartsAt: r.shift_starts_at,
    shiftEndsAt: r.shift_ends_at,
    shiftLabel: r.shift_label,
  };
}

/**
 * Claims queued event emails (up to 50 at a time, until none are left or the
 * time budget is spent) and, in live mode, sends them and records each
 * result. Never throws: failures land in `error`. Call with the SERVICE-ROLE
 * client.
 */
export async function dispatchEventEmails({
  client,
  config,
  fetchImpl = fetch,
  budgetMs = 45_000,
  gapMs = 600,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: {
  client: Client;
  config: EventEmailsConfig;
  fetchImpl?: typeof fetch;
  budgetMs?: number;
  gapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DispatchResult> {
  const result: DispatchResult = {
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };

  if (config.mode === 'off') return result;

  if (config.mode === 'live' && config.missingForLive.length > 0) {
    result.error = `Live mode needs ${config.missingForLive.join(', ')}`;
    return result;
  }

  const writeErrors: string[] = [];
  const deadline = now() + budgetMs;

  async function write(
    id: string,
    values: Database['public']['Tables']['event_emails']['Update'],
  ) {
    const { error } = await client
      .from('event_emails')
      .update(values)
      .eq('id', id);

    if (error) {
      console.error(`Event email ${id} could not be recorded:`, error);
      writeErrors.push(error.message);
    }
  }

  /** `attempts` is incremented by the claim but not returned by it. */
  async function attemptsFor(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;

    const { data, error } = await client
      .from('event_emails')
      .select('id, attempts')
      .in('id', ids);

    if (error) {
      writeErrors.push(error.message);
      return map;
    }

    for (const row of data ?? []) map.set(row.id, row.attempts);

    return map;
  }

  async function record(
    row: ClaimedEventEmail,
    outcome: Outcome,
    attempts: Map<string, number>,
  ) {
    if (outcome.ok) {
      result.sent += 1;
      await write(row.emailId, {
        status: 'sent',
        resend_email_id: outcome.id,
        sent_at: new Date(now()).toISOString(),
        error: null,
      });
      return;
    }

    result.failed += 1;

    if (!outcome.retryable) {
      await write(row.emailId, { status: 'dead', error: outcome.error });
      return;
    }

    const used = attempts.get(row.emailId) ?? 1;

    // The last attempt is `dead`, not `failed`, so it never expires silently.
    await write(row.emailId, {
      status: used >= MAX_ATTEMPTS ? 'dead' : 'failed',
      next_attempt_at: new Date(now() + BACKOFF_MS * used).toISOString(),
      error: outcome.error,
    });
  }

  try {
    while (now() < deadline) {
      const { data, error } = await client.rpc('event_emails_claim', {
        p_mode: config.mode,
        p_limit: CLAIM_LIMIT,
      });

      if (error) {
        result.error = error.message;
        break;
      }

      const rows = (data ?? []).map(toClaimed);

      if (rows.length === 0) break;

      result.candidates += rows.length;

      if (config.mode === 'dry_run') {
        result.skipped += rows.length;
        continue;
      }

      const attempts = await attemptsFor(rows.map((r) => r.emailId));
      const batch: { row: ClaimedEventEmail; email: OutgoingEmail }[] = [];
      const single: typeof batch = [];

      for (const row of rows) {
        if (row.kind === 'reminder' && row.eventStatus === 'cancelled') {
          result.skipped += 1;
          await write(row.emailId, { status: 'superseded' });
          continue;
        }

        if (!isPlausibleEmail(row.email)) {
          await record(
            row,
            { ok: false, error: INVALID_EMAIL_ERROR, retryable: false },
            attempts,
          );
          continue;
        }

        try {
          const rendered = renderEventEmail(row, {
            siteUrl: config.siteUrl,
            from: config.from,
            now: new Date(now()),
          });
          const email: OutgoingEmail = {
            from: config.from,
            to: row.email,
            replyTo: config.replyTo || undefined,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            tags: [{ name: 'event_email_id', value: row.emailId }],
            ...(rendered.ics
              ? {
                  attachments: [
                    {
                      filename: rendered.ics.filename,
                      content: rendered.ics.content,
                      contentType: rendered.ics.contentType,
                    },
                  ],
                }
              : {}),
          };

          (rendered.ics ? single : batch).push({ row, email });
        } catch (e) {
          await record(
            row,
            {
              ok: false,
              error: `render failed: ${e instanceof Error ? e.message : String(e)}`,
              retryable: false,
            },
            attempts,
          );
        }
      }

      if (batch.length > 0) {
        const sent = await sendBatch(
          config.apiKey,
          batch.map((b) => b.email),
          fetchImpl,
        );

        for (const [i, b] of batch.entries()) {
          await record(b.row, batchOutcome(sent[i]!), attempts);
        }
      }

      for (const [i, s] of single.entries()) {
        if (i > 0 && gapMs > 0) await sleep(gapMs);

        const outcome = await sendEmail(config.apiKey, s.email, {
          idempotencyKey: `event-email/${s.row.emailId}`,
          fetchImpl,
        });

        await record(s.row, outcome, attempts);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  if (!result.error && writeErrors.length > 0) {
    result.error = `Could not record ${writeErrors.length} email outcome(s): ${writeErrors[0]}`;
  }

  return result;
}
