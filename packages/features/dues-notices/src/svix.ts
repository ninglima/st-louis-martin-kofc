import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

/** Svix (Resend webhooks): v1 = base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)),
 * key = base64-decoded part of `whsec_...`; the header may carry several
 * space-separated `v1,<sig>` values. */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  nowSeconds: number;
}): boolean {
  const ts = Number(input.timestamp);

  if (!input.secret.startsWith('whsec_') || !input.id || !Number.isFinite(ts))
    return false;
  if (Math.abs(input.nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest();

  return input.signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
