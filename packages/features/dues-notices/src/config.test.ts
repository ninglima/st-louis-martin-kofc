import { describe, expect, it } from 'vitest';

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
});
