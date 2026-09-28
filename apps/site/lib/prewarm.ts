import { isPortalPath } from '@kit/brand/config/paths';

/**
 * Starts the portal container during the moment between a visitor pointing
 * at a portal link and clicking it. At most one request per page view: the
 * first one wakes the container, and more would only add load.
 */
export function createPrewarmer({
  fetchVersion,
  pageOrigin,
}: {
  fetchVersion: () => void;
  pageOrigin: string;
}): (href: string | null) => void {
  let warmed = false;

  return (href) => {
    if (warmed || !href) return;

    let url: URL;

    try {
      url = new URL(href, pageOrigin);
    } catch {
      return;
    }

    if (url.origin !== pageOrigin || !isPortalPath(url.pathname)) return;

    warmed = true;
    fetchVersion();
  };
}
