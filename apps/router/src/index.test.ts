import { SELF } from 'cloudflare:test';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { setupNetwork } from '@msw/cloudflare';

/**
 * `cloudflare:test`'s `fetchMock` (the brief's original mocking API) has been
 * removed as of `@cloudflare/vitest-pool-workers@0.20`: the module now only
 * exports the helpers listed in its own `dist/worker/lib/cloudflare/test.mjs`
 * (no `fetchMock`, no `MockAgent`). Cloudflare's own `request-mocking`
 * fixture (cloudflare/workers-sdk) mocks outbound `fetch()` with
 * `@msw/cloudflare`'s `setupNetwork()` instead, so this test does the same;
 * the assertions below are otherwise unchanged from the brief.
 */
const network = setupNetwork();

beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());

/**
 * `@msw/cloudflare`'s default for a request that matches no handler is to
 * let it through to the real network (msw's `onUnhandledFrame: "warn"`
 * default), not to fail the test. Without a catch-all, a misrouted request
 * (e.g. `/homework` accidentally sent to the portal) would still resolve --
 * Google's Cloud Run front end also answers unknown paths with 404 -- and
 * these tests would pass for the wrong reason. Registering a catch-all
 * handler makes any outbound request other than the ones a test explicitly
 * mocks fail loudly (599) and recorded, so "without touching the portal" is
 * actually verified.
 */
function trackOutboundRequests(): string[] {
  const calls: string[] = [];

  network.use(
    http.all('*', ({ request }) => {
      calls.push(request.url);

      return HttpResponse.text('unexpected outbound request', {
        status: 599,
      });
    }),
  );

  return calls;
}

describe('router', () => {
  it('serves a site page from the static assets without touching the portal', async () => {
    const calls = trackOutboundRequests();

    const response = await SELF.fetch('https://kofc-15256.org/who-we-are');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html');
    expect(calls).toEqual([]);
  });

  it('serves the static 404 page for an unknown non-portal path', async () => {
    const calls = trackOutboundRequests();

    const response = await SELF.fetch('https://kofc-15256.org/homework');

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Ouch! :|');
    expect(calls).toEqual([]);
  });

  it('proxies a portal path and rewrites its redirect', async () => {
    network.use(
      http.get('https://portal-abc.a.run.app/home', () =>
        HttpResponse.text('', {
          status: 307,
          headers: {
            location: 'https://portal-abc.a.run.app/auth/sign-in?next=/home',
          },
        }),
      ),
    );

    const response = await SELF.fetch('https://kofc-15256.org/home', {
      redirect: 'manual',
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://kofc-15256.org/auth/sign-in?next=/home',
    );
  });
});
