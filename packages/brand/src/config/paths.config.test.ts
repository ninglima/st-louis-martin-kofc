import { describe, expect, it } from 'vitest';

import { PORTAL_PREFIXES, isPortalPath } from './paths.config';

describe('isPortalPath', () => {
  it.each([
    '/home',
    '/home/',
    '/home/members',
    '/auth/sign-in',
    '/auth/callback',
    '/update-password',
    '/api/webhooks/stripe',
    '/version',
    '/portal-assets/_next/static/chunks/app.js',
  ])('treats %s as a portal path', (path) => {
    expect(isPortalPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/homework',
    '/authors',
    '/api-docs',
    '/versions',
    '/who-we-are',
    '/get-involved/pay-dues',
    '/please-wait',
    '/_next/static/chunks/app.js',
  ])('treats %s as a site path', (path) => {
    expect(isPortalPath(path)).toBe(false);
  });

  it('pins the exact prefix list the router and portal share', () => {
    expect(PORTAL_PREFIXES).toEqual([
      '/home',
      '/auth',
      '/update-password',
      '/api',
      '/version',
      '/portal-assets',
    ]);
  });
});
