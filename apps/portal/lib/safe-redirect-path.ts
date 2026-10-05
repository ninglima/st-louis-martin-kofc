const BASE = 'http://portal.invalid';

/**
 * `input` as a same-origin path, or `fallback` when it could send the
 * browser anywhere else. Redirect targets come from the `next` query
 * parameter, which anyone can set, and the portal redirects with a
 * path-only Location, so `//evil.com` or `/\evil.com` would be read by the
 * browser as another host.
 *
 * The result is the parsed path, so what is checked is exactly what is sent.
 */
export function safeRedirectPath(
  input: string | null | undefined,
  fallback = '/home',
): string {
  if (!input || !input.startsWith('/')) return fallback;

  let url: URL;

  try {
    url = new URL(input, BASE);
  } catch {
    return fallback;
  }

  if (url.origin !== BASE) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;

  // `/..//evil.com` parses to the path `//evil.com`: same origin here, but
  // another host once the browser reads it as a Location.
  if (path.startsWith('//') || path.includes('\\')) return fallback;

  return path;
}
