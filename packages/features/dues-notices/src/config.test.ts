import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readNoticesConfig } from './config';

describe('readNoticesConfig', () => {
  it('defaults to off', () => {
    expect(readNoticesConfig({}).mode).toBe('off');
    expect(readNoticesConfig({ DUES_NOTICES_MODE: 'LOUD' }).mode).toBe('off');
  });

  it('reads dry-run and live', () => {
    expect(readNoticesConfig({ DUES_NOTICES_MODE: 'dry-run' }).mode).toBe(
      'dry_run',
    );
    expect(readNoticesConfig({ DUES_NOTICES_MODE: ' live ' }).mode).toBe(
      'live',
    );
  });

  it('lists what live mode is missing', () => {
    expect(
      readNoticesConfig({ DUES_NOTICES_MODE: 'live' }).missingForLive,
    ).toEqual(['RESEND_API_KEY', 'DUES_NOTICES_FROM', 'NEXT_PUBLIC_SITE_URL']);
    expect(
      readNoticesConfig({
        DUES_NOTICES_MODE: 'live',
        RESEND_API_KEY: 're_x',
        DUES_NOTICES_FROM: 'FS <dues@example.org>',
        NEXT_PUBLIC_SITE_URL: 'https://example.org/',
      }),
    ).toMatchObject({ missingForLive: [], siteUrl: 'https://example.org' });
  });

  describe('refuses a site URL a member could not open', () => {
    const base = {
      DUES_NOTICES_MODE: 'live',
      RESEND_API_KEY: 're_x',
      DUES_NOTICES_FROM: 'FS <dues@example.org>',
    };

    it.each([
      'http://localhost:3000',
      'https://localhost:3000',
      'https://127.0.0.1',
      'https://portal.localhost',
      'http://example.org',
      'example.org',
    ])('%s', (url) => {
      const { missingForLive } = readNoticesConfig({
        ...base,
        NEXT_PUBLIC_SITE_URL: url,
      });

      expect(missingForLive).toHaveLength(1);
      expect(missingForLive[0]).toMatch(/^NEXT_PUBLIC_SITE_URL to be /);
      expect(missingForLive[0]).toContain(url);
    });

    it('names the build-time public https origin', () => {
      expect(
        readNoticesConfig({
          ...base,
          NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
        }).missingForLive,
      ).toEqual([
        'NEXT_PUBLIC_SITE_URL to be the public https origin baked in at build time (got "http://localhost:3000")',
      ]);
    });
  });

  it('reads the site URL from the literal process.env by default', () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://council.example.org';

    try {
      expect(readNoticesConfig().siteUrl).toBe('https://council.example.org');
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });
});
