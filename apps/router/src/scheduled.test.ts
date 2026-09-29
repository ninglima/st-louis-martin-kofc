import { describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import { runDuesNoticesTrigger } from './scheduled';

const env = {
  PORTAL_ORIGIN: 'https://portal-abc.a.run.app',
  ORIGIN_AUTH: 'origin-secret',
  DUES_JOBS_SECRET: 'jobs-secret',
} as Env;

describe('runDuesNoticesTrigger', () => {
  it('posts to the portal job with both secrets', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await runDuesNoticesTrigger(env, fetchImpl as never);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://portal-abc.a.run.app/api/jobs/dues-notices');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer jobs-secret',
    );
    expect(new Headers(init.headers).get('x-origin-auth')).toBe(
      'origin-secret',
    );
  });

  it('does nothing without a jobs secret', async () => {
    const fetchImpl = vi.fn();
    await expect(
      runDuesNoticesTrigger(
        { ...env, DUES_JOBS_SECRET: '' },
        fetchImpl as never,
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
