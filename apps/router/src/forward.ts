import type { Env } from './env';

const ASSET_PREFIX = '/portal-assets';

/**
 * The request the portal receives. The method, headers and body stream
 * through untouched, because Stripe and Square sign the raw body. Redirects
 * are not followed, so the browser sees the portal's own redirect.
 */
export function buildOriginRequest(request: Request, env: Env): Request {
  const incoming = new URL(request.url);
  const target = new URL(env.PORTAL_ORIGIN);

  target.pathname = incoming.pathname.startsWith(`${ASSET_PREFIX}/`)
    ? incoming.pathname.slice(ASSET_PREFIX.length)
    : incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  // Cloud Run routes by Host, so the client's Host (the public origin) must
  // not ride along -- the fetch target URL already supplies the portal's own
  // host.
  headers.delete('host');
  headers.set('x-origin-auth', env.ORIGIN_AUTH);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

/**
 * The portal builds absolute redirects from the Host it received, which
 * behind the router is the Cloud Run host. That host is origin-locked, so
 * any Location pointing at it is moved to the public origin.
 */
export function rewriteLocation(
  response: Response,
  portalOrigin: string,
  publicOrigin: string,
): Response {
  const location = response.headers.get('location');

  if (!location) {
    return response;
  }

  let target: URL;

  try {
    target = new URL(location);
  } catch {
    return response;
  }

  if (target.origin !== new URL(portalOrigin).origin) {
    return response;
  }

  const rewritten = new URL(
    `${target.pathname}${target.search}${target.hash}`,
    publicOrigin,
  );
  const copy = new Response(response.body, response);
  copy.headers.set('location', rewritten.href);

  return copy;
}
