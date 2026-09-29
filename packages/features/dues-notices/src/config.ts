import type { NoticesMode } from './types';

export interface NoticesConfig {
  mode: NoticesMode;
  apiKey: string;
  webhookSecret: string;
  jobsSecret: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  /** Env names live mode needs but lacks; empty when live can send. */
  missingForLive: string[];
}

function parseMode(raw: string | undefined): NoticesMode {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'live') return 'live';
  if (value === 'dry-run' || value === 'dry_run') return 'dry_run';

  return 'off';
}

export function readNoticesConfig(
  env: Record<string, string | undefined> = process.env,
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
    ['NEXT_PUBLIC_SITE_URL', config.siteUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name as string);

  return { ...config, missingForLive };
}
