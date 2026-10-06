import 'server-only';

import { parseEmailAllowlist } from '@kit/email/allowlist';
import { type EmailMode, parseMode, siteUrlProblem } from '@kit/email/mode';

export interface PaymentReceiptsConfig {
  mode: EmailMode;
  apiKey: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  /** Non-null when EMAIL_ALLOWLIST is set: only these addresses get live mail. */
  allowlist: ReadonlySet<string> | null;
  /** What live mode needs but lacks; empty when live can send. */
  missingForLive: string[];
}

/**
 * NEXT_PUBLIC_SITE_URL is passed as the literal
 * `process.env.NEXT_PUBLIC_SITE_URL` so Next inlines it at build time, as
 * `@kit/dues-notices` / `@kit/event-emails` do.
 */
export function readPaymentReceiptsConfig(
  env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
): PaymentReceiptsConfig {
  const config = {
    mode: parseMode(env.PAYMENT_RECEIPTS_MODE),
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    from: env.PAYMENT_RECEIPTS_FROM?.trim() ?? '',
    replyTo: env.PAYMENT_RECEIPTS_REPLY_TO?.trim() ?? '',
    siteUrl: (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, ''),
    allowlist: parseEmailAllowlist(env.EMAIL_ALLOWLIST),
  };

  const missingForLive = [
    ['RESEND_API_KEY', config.apiKey],
    ['PAYMENT_RECEIPTS_FROM', config.from],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  const siteProblem = siteUrlProblem(config.siteUrl);

  if (siteProblem) missingForLive.push(siteProblem);

  return { ...config, missingForLive };
}
