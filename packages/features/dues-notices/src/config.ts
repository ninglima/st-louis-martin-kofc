import 'server-only';

import type { NoticesMode } from './types';

export interface NoticesConfig {
  mode: NoticesMode;
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

function parseMode(raw: string | undefined): NoticesMode {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'live') return 'live';
  if (value === 'dry-run' || value === 'dry_run') return 'dry_run';

  return 'off';
}

/** A site URL a member can open from their inbox: https, and not a
 * loopback host. */
function siteUrlProblem(siteUrl: string): string | null {
  if (!siteUrl) return 'NEXT_PUBLIC_SITE_URL';

  let url: URL;

  try {
    url = new URL(siteUrl);
  } catch {
    return `NEXT_PUBLIC_SITE_URL to be a valid URL (got "${siteUrl}")`;
  }

  const host = url.hostname.toLowerCase();
  const loopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '0.0.0.0';

  if (url.protocol !== 'https:' || loopback) {
    return `NEXT_PUBLIC_SITE_URL to be the public https origin baked in at build time (got "${siteUrl}")`;
  }

  return null;
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
