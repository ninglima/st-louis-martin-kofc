import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readEventEmailsConfig } from './config';

const full = {
  EVENT_EMAILS_MODE: 'live',
  RESEND_API_KEY: 're_x',
  EVENT_EMAILS_FROM: 'Council <council@example.org>',
  NEXT_PUBLIC_SITE_URL: 'https://portal.example.org',
};

describe('readEventEmailsConfig', () => {
  it('defaults to off', () => {
    expect(readEventEmailsConfig({}).mode).toBe('off');
    expect(readEventEmailsConfig({ EVENT_EMAILS_MODE: 'LOUD' }).mode).toBe(
      'off',
    );
  });

  it('reads dry-run, dry_run and live', () => {
    expect(readEventEmailsConfig({ EVENT_EMAILS_MODE: 'dry-run' }).mode).toBe(
      'dry_run',
    );
    expect(readEventEmailsConfig({ EVENT_EMAILS_MODE: 'dry_run' }).mode).toBe(
      'dry_run',
    );
    expect(readEventEmailsConfig({ EVENT_EMAILS_MODE: ' live ' }).mode).toBe(
      'live',
    );
  });

  it('lists everything live mode is missing', () => {
    expect(
      readEventEmailsConfig({ EVENT_EMAILS_MODE: 'live' }).missingForLive,
    ).toEqual(['RESEND_API_KEY', 'EVENT_EMAILS_FROM', 'NEXT_PUBLIC_SITE_URL']);
  });

  it('reports each missing item on its own', () => {
    expect(
      readEventEmailsConfig({ ...full, RESEND_API_KEY: '' }).missingForLive,
    ).toEqual(['RESEND_API_KEY']);
    expect(
      readEventEmailsConfig({ ...full, EVENT_EMAILS_FROM: ' ' }).missingForLive,
    ).toEqual(['EVENT_EMAILS_FROM']);
    expect(
      readEventEmailsConfig({ ...full, NEXT_PUBLIC_SITE_URL: '' })
        .missingForLive,
    ).toEqual(['NEXT_PUBLIC_SITE_URL']);
  });

  it('refuses a localhost or http site URL', () => {
    for (const url of ['http://localhost:3000', 'http://portal.example.org']) {
      const { missingForLive } = readEventEmailsConfig({
        ...full,
        NEXT_PUBLIC_SITE_URL: url,
      });

      expect(missingForLive).toHaveLength(1);
      expect(missingForLive[0]).toContain('NEXT_PUBLIC_SITE_URL');
    }
  });

  it('is complete when everything is set, and reads the shared secrets', () => {
    const c = readEventEmailsConfig({
      ...full,
      EVENT_EMAILS_REPLY_TO: 'fs@example.org',
      RESEND_WEBHOOK_SECRET: 'whsec_x',
      DUES_JOBS_SECRET: 'jobs',
      NEXT_PUBLIC_SITE_URL: 'https://portal.example.org/',
    });

    expect(c.missingForLive).toEqual([]);
    expect(c.siteUrl).toBe('https://portal.example.org');
    expect(c.replyTo).toBe('fs@example.org');
    expect(c.webhookSecret).toBe('whsec_x');
    expect(c.jobsSecret).toBe('jobs');
    expect(c.allowlist).toBeNull();
  });

  it('parses EMAIL_ALLOWLIST', () => {
    expect(
      readEventEmailsConfig({ ...full, EMAIL_ALLOWLIST: 'a@b.com' }).allowlist,
    ).toEqual(new Set(['a@b.com']));
  });
});
