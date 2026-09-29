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

async function sendOne(
  apiKey: string,
  batch: OutgoingEmail[],
  fetchImpl: typeof fetch,
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
    const message = error instanceof Error ? error.message : String(error);
    return batch.map(() => ({ ok: false, error: message }));
  }
}

/** Sends through Resend's batch API, 100 per request; results in input order. */
export async function sendBatch(
  apiKey: string,
  emails: OutgoingEmail[],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    results.push(
      ...(await sendOne(apiKey, emails.slice(i, i + BATCH_SIZE), fetchImpl)),
    );
  }

  return results;
}
