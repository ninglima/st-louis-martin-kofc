import {
  isEmailAllowlisted,
  parseEmailAllowlist,
} from '@kit/email/allowlist';
import { parseMode, siteUrlProblem, type EmailMode } from '@kit/email/mode';

export interface MemberInvitesConfig {
  mode: EmailMode;
  apiKey: string;
  from: string;
  siteUrl: string;
  allowlist: ReadonlySet<string> | null;
  /** What live mode needs but lacks; empty when live can send. */
  missingForLive: string[];
}

/**
 * `NEXT_PUBLIC_SITE_URL` is passed as the literal
 * `process.env.NEXT_PUBLIC_SITE_URL` so Next inlines it at build time, as
 * the other mailers do.
 */
export function readMemberInvitesConfig(
  env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
): MemberInvitesConfig {
  const config = {
    mode: parseMode(env.MEMBER_INVITES_MODE),
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    from: env.MEMBER_INVITES_FROM?.trim() ?? '',
    siteUrl: (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, ''),
    allowlist: parseEmailAllowlist(env.EMAIL_ALLOWLIST),
  };

  const siteProblem = siteUrlProblem(config.siteUrl);

  return {
    ...config,
    missingForLive: [
      ...(config.apiKey ? [] : ['RESEND_API_KEY']),
      ...(config.from ? [] : ['MEMBER_INVITES_FROM']),
      ...(siteProblem ? [siteProblem] : []),
    ],
  };
}
