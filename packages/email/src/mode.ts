export type EmailMode = 'off' | 'dry_run' | 'live';

export function parseMode(raw: string | undefined): EmailMode {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'live') return 'live';
  if (value === 'dry-run' || value === 'dry_run') return 'dry_run';

  return 'off';
}

/** A site URL a member can open from their inbox: https, and not a
 * loopback host. */
export function siteUrlProblem(siteUrl: string): string | null {
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
