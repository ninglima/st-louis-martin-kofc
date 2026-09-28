import { describe, expect, it } from 'vitest';

import { classify, pleaseWaitEligible } from './routing';

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

const navigation = (path: string, init: RequestInit = {}) => {
  const request = new Request(`https://kofc-15256.org${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    ...init,
  });

  return [request, new URL(request.url)] as const;
};

describe('pleaseWaitEligible', () => {
  it('accepts an HTML GET navigation to a portal page', () => {
    expect(pleaseWaitEligible(...navigation('/home/members'))).toBe(true);
    expect(pleaseWaitEligible(...navigation('/auth/sign-in?next=/home'))).toBe(
      true,
    );
  });

  it.each(['/auth/callback?code=abc', '/auth/confirm?token_hash=x'])(
    'never interrupts one-time-code route %s',
    (path) => expect(pleaseWaitEligible(...navigation(path))).toBe(false),
  );

  it('never interrupts a POST, server action or webhook', () => {
    expect(pleaseWaitEligible(...navigation('/home', { method: 'POST' }))).toBe(
      false,
    );
  });

  it('never interrupts assets or non-HTML requests', () => {
    expect(
      pleaseWaitEligible(...navigation('/portal-assets/_next/static/a.js')),
    ).toBe(false);
    const [request, url] = navigation('/version', {
      headers: { accept: '*/*' },
    });
    expect(pleaseWaitEligible(request, url)).toBe(false);
  });
});
