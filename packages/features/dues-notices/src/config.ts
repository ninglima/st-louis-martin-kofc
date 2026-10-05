import 'server-only';

import { parseEmailAllowlist } from '@kit/email/allowlist';
import { parseMode, siteUrlProblem } from '@kit/email/mode';

import type { NoticesMode } from './types';

export interface NoticesConfig {
  mode: NoticesMode;
  apiKey: string;
  webhookSecret: string;
  jobsSecret: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  /** Non-null when EMAIL_ALLOWLIST is set: only these addresses get live mail. */
  allowlist: ReadonlySet<string> | null;
  /** What live mode needs but lacks (a missing env name, or a site URL that
   * is not a public https origin); empty when live can send. */
  missingForLive: string[];
}

/**
 * The default env passes NEXT_PUBLIC_SITE_URL as the literal
 * `process.env.NEXT_PUBLIC_SITE_URL`, which Next inlines at build time (like
 * appConfig.url). Read through a variable instead, it would be looked up at
 * runtime, where the standalone server loads the committed `.env` and gets
 * `http://localhost:3000`: the build arg never reaches the runtime env.
 */
export function readNoticesConfig(
  env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
): NoticesConfig {
  const config = {
    mode: parseMode(env.DUES_NOTICES_MODE),
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    webhookSecret: env.RESEND_WEBHOOK_SECRET?.trim() ?? '',
    jobsSecret: env.DUES_JOBS_SECRET?.trim() ?? '',
    from: env.DUES_NOTICES_FROM?.trim() ?? '',
    replyTo: env.DUES_NOTICES_REPLY_TO?.trim() ?? '',
    siteUrl: (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, ''),
    allowlist: parseEmailAllowlist(env.EMAIL_ALLOWLIST),
  };

  const missingForLive = [
    ['RESEND_API_KEY', config.apiKey],
    ['DUES_NOTICES_FROM', config.from],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  const siteProblem = siteUrlProblem(config.siteUrl);

  if (siteProblem) missingForLive.push(siteProblem);

  return { ...config, missingForLive };
}
