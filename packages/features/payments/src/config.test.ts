import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readPaymentReceiptsConfig } from './config';

const full = {
  PAYMENT_RECEIPTS_MODE: 'live',
  RESEND_API_KEY: 're_x',
  PAYMENT_RECEIPTS_FROM: 'Council <council@example.org>',
  NEXT_PUBLIC_SITE_URL: 'https://portal.example.org',
};

describe('readPaymentReceiptsConfig', () => {
  it('defaults to off', () => {
    expect(readPaymentReceiptsConfig({}).mode).toBe('off');
    expect(
      readPaymentReceiptsConfig({ PAYMENT_RECEIPTS_MODE: 'LOUD' }).mode,
    ).toBe('off');
  });

  it('reads dry-run, dry_run and live', () => {
    expect(
      readPaymentReceiptsConfig({ PAYMENT_RECEIPTS_MODE: 'dry-run' }).mode,
    ).toBe('dry_run');
    expect(
      readPaymentReceiptsConfig({ PAYMENT_RECEIPTS_MODE: 'dry_run' }).mode,
    ).toBe('dry_run');
    expect(
      readPaymentReceiptsConfig({ PAYMENT_RECEIPTS_MODE: ' live ' }).mode,
    ).toBe('live');
  });

  it('lists everything live mode is missing', () => {
    expect(
      readPaymentReceiptsConfig({ PAYMENT_RECEIPTS_MODE: 'live' })
        .missingForLive,
    ).toEqual([
      'RESEND_API_KEY',
      'PAYMENT_RECEIPTS_FROM',
      'NEXT_PUBLIC_SITE_URL',
    ]);
  });

  it('reports each missing item on its own', () => {
    expect(
      readPaymentReceiptsConfig({ ...full, RESEND_API_KEY: '' }).missingForLive,
    ).toEqual(['RESEND_API_KEY']);
    expect(
      readPaymentReceiptsConfig({ ...full, PAYMENT_RECEIPTS_FROM: ' ' })
        .missingForLive,
    ).toEqual(['PAYMENT_RECEIPTS_FROM']);
    expect(
      readPaymentReceiptsConfig({ ...full, NEXT_PUBLIC_SITE_URL: '' })
        .missingForLive,
    ).toEqual(['NEXT_PUBLIC_SITE_URL']);
  });

  it('refuses a localhost or http site URL', () => {
    for (const url of ['http://localhost:3000', 'http://portal.example.org']) {
      const { missingForLive } = readPaymentReceiptsConfig({
        ...full,
        NEXT_PUBLIC_SITE_URL: url,
      });

      expect(missingForLive).toHaveLength(1);
      expect(missingForLive[0]).toContain('NEXT_PUBLIC_SITE_URL');
    }
  });

  it('is complete when everything is set', () => {
    const c = readPaymentReceiptsConfig({
      ...full,
      PAYMENT_RECEIPTS_REPLY_TO: 'fs@example.org',
      NEXT_PUBLIC_SITE_URL: 'https://portal.example.org/',
    });

    expect(c.missingForLive).toEqual([]);
    expect(c.siteUrl).toBe('https://portal.example.org');
    expect(c.replyTo).toBe('fs@example.org');
    expect(c.allowlist).toBeNull();
  });

  it('parses EMAIL_ALLOWLIST', () => {
    expect(
      readPaymentReceiptsConfig({ ...full, EMAIL_ALLOWLIST: 'a@b.com' })
        .allowlist,
    ).toEqual(new Set(['a@b.com']));
  });
});
