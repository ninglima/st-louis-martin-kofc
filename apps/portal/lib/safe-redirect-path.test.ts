import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from './safe-redirect-path';

describe('safeRedirectPath', () => {
  it.each(['/home/checkout', '/home/checkout?x=1', '/update-password', '/'])(
    'keeps the same-origin path %s',
    (path) => expect(safeRedirectPath(path)).toBe(path),
  );

  it.each([
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/..//evil.com',
    'https://evil.com',
    'https://x//evil.com',
    'javascript:alert(1)',
    'home/checkout',
    '',
    null,
    undefined,
  ])('falls back for %j', (input) =>
    expect(safeRedirectPath(input)).toBe('/home'),
  );

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//evil.com', '/auth/sign-in')).toBe(
      '/auth/sign-in',
    );
  });

  // Percent-encoded slashes stay encoded in the path, so the browser treats
  // `/%2F%2Fevil.com` as a path on this origin, not as a host. Kept.
  it('keeps an encoded double slash as a same-origin path', () => {
    expect(safeRedirectPath('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
  });
});
