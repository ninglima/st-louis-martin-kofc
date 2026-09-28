import { isPortalPath } from '@kit/brand/config/paths';

export function classify(url: URL): 'portal' | 'site' {
  return isPortalPath(url.pathname) ? 'portal' : 'site';
}

/** Filled in by the cold-start task; until then no request gets the waiting page. */
export function pleaseWaitEligible(_request: Request, _url: URL): boolean {
  return false;
}
