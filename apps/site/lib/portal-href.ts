import { isPortalPath } from '@kit/brand/config/paths';

/**
 * In production the site and the portal share one origin, so a portal link
 * stays relative. In `pnpm dev` the portal runs on its own port, named by
 * NEXT_PUBLIC_PORTAL_URL, and portal links are sent there.
 */
export function portalHref(
  href: string,
  portalUrl: string | undefined = process.env.NEXT_PUBLIC_PORTAL_URL,
): string {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }

  const pathname = href.split(/[?#]/, 1)[0] ?? href;

  if (!portalUrl || !isPortalPath(pathname)) {
    return href;
  }

  return `${portalUrl.replace(/\/+$/, '')}${href}`;
}
