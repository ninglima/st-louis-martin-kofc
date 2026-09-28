import { describe, expect, it } from 'vitest';

import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';

const env = {
  PORTAL_ORIGIN: 'https://portal-abc.a.run.app',
  ORIGIN_AUTH: 'test-secret',
} as Env;

describe('buildOriginRequest', () => {
  it('targets the portal origin, keeping path and query', () => {
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/auth/sign-in?next=/home/checkout'),
      env,
    );

    expect(origin.url).toBe(
      'https://portal-abc.a.run.app/auth/sign-in?next=/home/checkout',
    );
  });

  it('strips /portal-assets before proxying', () => {
    const origin = buildOriginRequest(
      new Request(
        'https://kofc-15256.org/portal-assets/_next/static/chunks/a.js?v=1',
      ),
      env,
    );

    expect(origin.url).toBe(
      'https://portal-abc.a.run.app/_next/static/chunks/a.js?v=1',
    );
  });

  it('adds the origin secret and forwarded headers, and overwrites a spoofed secret', () => {
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/home', {
        headers: { 'x-origin-auth': 'forged', cookie: 'sb=1' },
      }),
      env,
    );

    expect(origin.headers.get('x-origin-auth')).toBe('test-secret');
    expect(origin.headers.get('x-forwarded-host')).toBe('kofc-15256.org');
    expect(origin.headers.get('x-forwarded-proto')).toBe('https');
    expect(origin.headers.get('cookie')).toBe('sb=1');
    expect(origin.redirect).toBe('manual');
  });

  it('forwards a binary body byte-for-byte with its method and content type', async () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'stripe-signature': 't=1,v1=abc',
        },
        body: bytes,
      }),
      env,
    );

    expect(origin.method).toBe('POST');
    expect(origin.headers.get('stripe-signature')).toBe('t=1,v1=abc');
    expect(new Uint8Array(await origin.arrayBuffer())).toEqual(bytes);
  });
});

describe('rewriteLocation', () => {
  it('rewrites a redirect on the portal origin to the public origin, keeping path and query', () => {
    const response = rewriteLocation(
      new Response(null, {
        status: 307,
        headers: {
          location: 'https://portal-abc.a.run.app/auth/sign-in?next=/home',
        },
      }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://kofc-15256.org/auth/sign-in?next=/home',
    );
  });

  it('leaves relative and third-party redirects alone', () => {
    const relative = rewriteLocation(
      new Response(null, { status: 302, headers: { location: '/home' } }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );
    const external = rewriteLocation(
      new Response(null, {
        status: 303,
        headers: { location: 'https://checkout.stripe.com/x' },
      }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(relative.headers.get('location')).toBe('/home');
    expect(external.headers.get('location')).toBe(
      'https://checkout.stripe.com/x',
    );
  });

  it('keeps every Set-Cookie header', () => {
    const headers = new Headers({
      location: 'https://portal-abc.a.run.app/home',
    });
    headers.append('set-cookie', 'sb-access=a; Path=/; HttpOnly');
    headers.append('set-cookie', 'sb-refresh=b; Path=/; HttpOnly');

    const response = rewriteLocation(
      new Response(null, { status: 302, headers }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(response.headers.getSetCookie()).toEqual([
      'sb-access=a; Path=/; HttpOnly',
      'sb-refresh=b; Path=/; HttpOnly',
    ]);
  });
});
