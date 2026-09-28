import { isPortalPath } from '@kit/brand/config/paths';

export function classify(url: URL): 'portal' | 'site' {
  return isPortalPath(url.pathname) ? 'portal' : 'site';
}

/** Routes carrying a one-time code: an abandoned first request could spend it. */
const NEVER_INTERRUPT = ['/auth/callback', '/auth/confirm'];

export function pleaseWaitEligible(request: Request, url: URL): boolean {
  if (request.method !== 'GET') return false;
  if (!(request.headers.get('accept') ?? '').includes('text/html'))
    return false;
  if (url.pathname.startsWith('/portal-assets/')) return false;

  return !NEVER_INTERRUPT.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
  );
}
