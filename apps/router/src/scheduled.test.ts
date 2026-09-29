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
      URL,
      RequestInit,
    ];
    expect(String(url)).toBe(
      'https://portal-abc.a.run.app/api/jobs/dues-notices',
    );
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

  it('builds the right URL when the origin has a trailing slash', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await runDuesNoticesTrigger(
      { ...env, PORTAL_ORIGIN: 'https://portal-abc.a.run.app/' },
      fetchImpl as never,
    );
    const [url] = fetchImpl.mock.calls[0]! as unknown as [URL];
    expect(String(url)).toBe(
      'https://portal-abc.a.run.app/api/jobs/dues-notices',
    );
  });

  it('logs a non-OK response and still returns it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    const response = await runDuesNoticesTrigger(env, fetchImpl as never);
    expect(response?.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs a thrown fetch, resolves to null, and does not reject', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      runDuesNoticesTrigger(env, fetchImpl as never),
    ).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls.flat().join(' ');
    expect(message).not.toContain('jobs-secret');
    expect(message).not.toContain('origin-secret');
    errorSpy.mockRestore();
  });
});
