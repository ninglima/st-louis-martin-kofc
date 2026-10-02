import 'server-only';

import { type EmailMode, parseMode, siteUrlProblem } from '@kit/email/mode';

export interface EventEmailsConfig {
  mode: EmailMode;
  apiKey: string;
  webhookSecret: string;
  jobsSecret: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  /** What live mode needs but lacks (a missing env name, or a site URL that
   * is not a public https origin); empty when live can send. */
  missingForLive: string[];
}

/**
 * NEXT_PUBLIC_SITE_URL is passed as the literal
 * `process.env.NEXT_PUBLIC_SITE_URL` so Next inlines it at build time, as
 * `@kit/dues-notices` does; read through a variable it would be looked up
 * at runtime and miss the build arg.
 */
export function readEventEmailsConfig(
  env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
): EventEmailsConfig {
  const config = {
    mode: parseMode(env.EVENT_EMAILS_MODE),
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    webhookSecret: env.RESEND_WEBHOOK_SECRET?.trim() ?? '',
    jobsSecret: env.DUES_JOBS_SECRET?.trim() ?? '',
    from: env.EVENT_EMAILS_FROM?.trim() ?? '',
    replyTo: env.EVENT_EMAILS_REPLY_TO?.trim() ?? '',
    siteUrl: (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, ''),
  };

  const missingForLive = [
    ['RESEND_API_KEY', config.apiKey],
    ['EVENT_EMAILS_FROM', config.from],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  const siteProblem = siteUrlProblem(config.siteUrl);

  if (siteProblem) missingForLive.push(siteProblem);

  return { ...config, missingForLive };
}
