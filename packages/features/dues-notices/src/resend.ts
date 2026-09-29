import 'server-only';

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  tags: { name: string; value: string }[];
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_LENGTH = 300;
const REDACTED = '[redacted]';

/**
 * Undici reports a stalled or reset connection as the bare message
 * `fetch failed`; the real reason lives in `error.cause`. Separately, an
 * invalid header value (e.g. a malformed API key) can echo the full
 * `Bearer <key>` back in the thrown error, so every occurrence of the raw
 * key is scrubbed before the message is stored. The result is capped so one
 * runaway error can't blow out a stored row.
 */
function formatThrownError(error: unknown, apiKey: string): string {
  const base = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined;
  const combined = cause ? `${base}: ${cause}` : base;
  const redacted = apiKey ? combined.split(apiKey).join(REDACTED) : combined;

  return redacted.slice(0, MAX_ERROR_LENGTH);
}

async function sendOne(
  apiKey: string,
  batch: OutgoingEmail[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SendResult[]> {
  try {
    const response = await fetchImpl(BATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        batch.map((e) => ({
          from: e.from,
          to: [e.to],
          ...(e.replyTo ? { reply_to: e.replyTo } : {}),
          subject: e.subject,
          html: e.html,
          text: e.text,
          tags: e.tags,
        })),
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const json = (await response.json().catch(() => ({}))) as {
      data?: { id: string }[];
      message?: string;
    };

    if (!response.ok) {
      const error = `Resend ${response.status}: ${json.message ?? response.statusText}`;
      return batch.map(() => ({ ok: false, error }));
    }

    return batch.map((_, i) => {
      const id = json.data?.[i]?.id;
      return id
        ? { ok: true, id }
        : { ok: false, error: 'Resend returned no id' };
    });
  } catch (error) {
    const message = formatThrownError(error, apiKey);
    return batch.map(() => ({ ok: false, error: message }));
  }
}

/**
 * Sends through Resend's batch API, 100 per request; results in input
 * order. Each request aborts after `timeoutMs` (default 30s) so a stalled
 * connection can't hang the job past its host's own deadline.
 */
export async function sendBatch(
  apiKey: string,
  emails: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    results.push(
      ...(await sendOne(
        apiKey,
        emails.slice(i, i + BATCH_SIZE),
        fetchImpl,
        timeoutMs,
      )),
    );
  }

  return results;
}
