import 'server-only';

const VERIFY_ENDPOINT =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const CAPTCHA_SECRET_TOKEN = process.env.CAPTCHA_SECRET_TOKEN;

/** Must match `TURNSTILE_AUTH_ACTION` on the invisible widget. */
const EXPECTED_ACTION = 'auth';

function expectedHostnames(): Set<string> {
  const fromEnv = (process.env.CAPTCHA_EXPECTED_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) {
    return new Set(fromEnv);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!siteUrl) {
    return new Set();
  }

  try {
    return new Set([new URL(siteUrl).hostname]);
  } catch {
    return new Set();
  }
}

/**
 * Canonical Turnstile siteverify for server actions / routes that opt into
 * `captcha: true`. Password sign-in also sends the token to Supabase Auth,
 * which verifies with the same secret configured in the Supabase dashboard.
 */
export async function verifyCaptchaToken(
  token: string,
  remoteIp?: string,
) {
  if (!CAPTCHA_SECRET_TOKEN) {
    throw new Error('CAPTCHA_SECRET_TOKEN is not set');
  }

  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 2048
  ) {
    throw new Error('Invalid CAPTCHA token');
  }

  const hostnames = expectedHostnames();

  if (hostnames.size === 0) {
    throw new Error(
      'CAPTCHA_EXPECTED_HOSTNAMES or NEXT_PUBLIC_SITE_URL must be set',
    );
  }

  const body = new URLSearchParams({
    secret: CAPTCHA_SECRET_TOKEN,
    response: token,
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  let data: {
    success?: boolean;
    action?: string;
    hostname?: string;
    'error-codes'?: string[];
  };

  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`Captcha siteverify HTTP ${res.status}`);
      throw new Error('Failed to verify CAPTCHA token');
    }

    data = (await res.json()) as typeof data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Failed to verify')) {
      throw error;
    }

    console.error('Captcha siteverify failed:', error);
    throw new Error('Failed to verify CAPTCHA token');
  }

  if (
    !data.success ||
    data.action !== EXPECTED_ACTION ||
    !data.hostname ||
    !hostnames.has(data.hostname)
  ) {
    console.error('Captcha rejected:', {
      success: data.success,
      action: data.action,
      hostname: data.hostname,
      errors: data['error-codes'],
    });
    throw new Error('Invalid CAPTCHA token');
  }
}
