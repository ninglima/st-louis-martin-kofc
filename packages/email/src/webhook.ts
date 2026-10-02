import { verifySvixSignature } from './svix';

const TRACKED = new Set([
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'suppressed',
  'failed',
  'opened',
  'clicked',
]);

type ResendTag = { name?: string; value?: string };

export type WebhookTags = Record<string, string>;

export interface WebhookEventRecord {
  id: string;
  type: string;
  occurredAt: string;
  svixId: string;
  payload: unknown;
}

/** One consumer of Resend events (dues notices, event emails, ...). The
 * first sink whose `match` finds a row stores the event. */
export interface WebhookSink {
  match(input: {
    tags: WebhookTags;
    emailId: string | undefined;
  }): Promise<{ id: string } | null>;
  store(record: WebhookEventRecord): Promise<void>;
}

/**
 * Resend echoes back the tags attached when sending, but the payload shape
 * isn't pinned down: it has been seen both as an array of `{ name, value }`
 * pairs and as a plain `{ name: value }` object. Both are accepted.
 */
function readTags(tags: unknown): WebhookTags {
  const out: WebhookTags = {};

  if (Array.isArray(tags)) {
    for (const tag of tags as ResendTag[]) {
      if (
        tag &&
        typeof tag.name === 'string' &&
        typeof tag.value === 'string'
      ) {
        out[tag.name] = tag.value;
      }
    }
  } else if (tags && typeof tags === 'object') {
    for (const [name, value] of Object.entries(tags)) {
      if (typeof value === 'string') out[name] = value;
    }
  }

  return out;
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; tags?: unknown };
}

/** Only Resend can produce a validly-signed body, so a parse failure here
 * means a malformed payload rather than an attack. Returning null (400)
 * rather than throwing (500) keeps a permanently bad payload from being
 * retried forever. */
function parseEvent(body: string): ResendEvent | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object'
      ? (parsed as ResendEvent)
      : null;
  } catch {
    return null;
  }
}

/** Verify, parse, and hand a tracked event to the first sink that claims it.
 * Anything no sink claims is acknowledged and ignored. */
export async function handleResendWebhookWithSinks({
  secret,
  headers,
  body,
  nowSeconds,
  sinks,
}: {
  secret: string;
  headers: Headers;
  body: string;
  nowSeconds: number;
  sinks: WebhookSink[];
}): Promise<{ status: number; stored: boolean }> {
  if (!secret) {
    // Svix retries with backoff, so once the secret is configured, events
    // queued while it was missing still get delivered -- but until then,
    // every delivery fails the same way, so this needs to be visible.
    console.error('RESEND_WEBHOOK_SECRET is not configured');
    return { status: 500, stored: false };
  }

  const svixId = headers.get('svix-id') ?? '';
  const valid = verifySvixSignature({
    secret,
    id: svixId,
    timestamp: headers.get('svix-timestamp') ?? '',
    signature: headers.get('svix-signature') ?? '',
    body,
    nowSeconds,
  });

  if (!valid) return { status: 400, stored: false };

  const event = parseEvent(body);

  if (!event) return { status: 400, stored: false };

  const type = (event.type ?? '').replace(/^email\./, '');

  if (!TRACKED.has(type)) return { status: 200, stored: false };

  const tags = readTags(event.data?.tags);
  const emailId = event.data?.email_id;

  for (const sink of sinks) {
    const match = await sink.match({ tags, emailId });

    if (!match) continue;

    await sink.store({
      id: match.id,
      type,
      occurredAt: event.created_at ?? new Date(nowSeconds * 1000).toISOString(),
      svixId,
      payload: event,
    });

    return { status: 200, stored: true };
  }

  return { status: 200, stored: false };
}
