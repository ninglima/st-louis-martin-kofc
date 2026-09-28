import { describe, expect, it } from 'vitest';

import { classify } from './routing';

const at = (path: string) => new URL(path, 'https://kofc-15256.org');

describe('classify', () => {
  it.each([
    '/home',
    '/home/',
    '/auth/sign-in',
    '/api/webhooks/stripe',
    '/version',
    '/update-password',
    '/portal-assets/_next/static/a.js',
  ])('sends %s to the portal', (path) =>
    expect(classify(at(path))).toBe('portal'),
  );

  it.each([
    '/',
    '/homework',
    '/authors',
    '/api-docs',
    '/versions',
    '/who-we-are',
    '/nope',
  ])('keeps %s on the site', (path) => expect(classify(at(path))).toBe('site'));
});
