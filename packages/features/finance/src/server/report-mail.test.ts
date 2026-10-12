import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { MonthlyWorksheet, PaymentPacket } from '../types';
import {
  readReportMailConfig,
  renderPacketReport,
  renderWorksheetReport,
  reportEmailBlocker,
  sendFinanceReport,
} from './report-mail';

const SITE = 'https://kofc-15256.org';

const worksheet: MonthlyWorksheet = {
  month: '2099-03-01',
  asOf: '2099-06-01',
  roster: 4,
  statusCounts: {
    current: 1,
    due_soon: 1,
    due: 1,
    lapsed: 1,
    no_record: 0,
  },
  receivedCents: 6000,
  onlineCents: 1000,
  checkCents: 2000,
  cashCents: 3000,
};

function packet(overrides: Partial<PaymentPacket> = {}): PaymentPacket {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Supreme, January 2099',
    supremeCents: 175,
    stateCents: null,
    note: 'stub enclosed',
    createdBy: null,
    createdAt: '2099-01-15T00:00:00Z',
    updatedAt: '2099-01-15T00:00:00Z',
    ...overrides,
  };
}

const ready = {
  RESEND_API_KEY: 're_test',
  DUES_NOTICES_FROM: 'FS <fs@kofc-15256.org>',
  NEXT_PUBLIC_SITE_URL: SITE,
};

describe('renderWorksheetReport', () => {
  const report = renderWorksheetReport(worksheet, SITE);

  it('names the worksheet month in the subject', () => {
    expect(report.subject).toBe('Council worksheet, March 2099');
  });

  it('lists the as-of date, roster, statuses, and received money', () => {
    expect(report.text).toContain('As of 2099-06-01');
    expect(report.text).toContain('Roster 4');
    expect(report.text).toContain('Current 1');
    expect(report.text).toContain('Due soon 1');
    expect(report.text).toContain('Due 1');
    expect(report.text).toContain('Lapsed 1');
    expect(report.text).toContain('No record 0');
    expect(report.text).toContain('Received $60.00');
    expect(report.text).toContain('Card $10.00');
    expect(report.text).toContain('Check $20.00');
    expect(report.text).toContain('Cash $30.00');
  });

  it('puts the subject and received total in the branded html', () => {
    expect(report.html).toContain('Council worksheet, March 2099');
    expect(report.html).toContain('$60.00');
    expect(report.html).toContain('Open reports');
    expect(report.html).toContain(`${SITE}/home/reports`);
  });
});

describe('renderPacketReport', () => {
  it('names the saved label in the subject', () => {
    expect(renderPacketReport(packet(), SITE).subject).toBe(
      'Payment packet: Supreme, January 2099',
    );
  });

  it('prints Supreme, the word blank for a null state total, and the note', () => {
    const text = renderPacketReport(packet(), SITE).text;

    expect(text).toContain('Supreme $1.75');
    expect(text).toMatch(/State blank\n\n/);
    expect(text).toContain('stub enclosed');
  });

  it('omits the note line when note is null', () => {
    expect(renderPacketReport(packet({ note: null }), SITE).text).not.toContain(
      'Note',
    );
  });

  it('formats a zero total as money and escapes a label in the html', () => {
    const zero = renderPacketReport(
      packet({ stateCents: 0, note: null }),
      SITE,
    );
    expect(zero.text).toContain('State $0.00');
    expect(zero.text).not.toContain('State blank');

    const hostile = renderPacketReport(
      packet({ label: 'Tom & <Jerry>', note: 'stub enclosed' }),
      SITE,
    );
    expect(hostile.html).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(hostile.html).not.toContain('Tom & <Jerry>');
  });
});

describe('readReportMailConfig', () => {
  it('lists a blank from address and drops a trailing slash', () => {
    const config = readReportMailConfig({
      RESEND_API_KEY: 're_test',
      DUES_NOTICES_FROM: '  ',
      EMAIL_ALLOWLIST: '',
      NEXT_PUBLIC_SITE_URL: `${SITE}/`,
    });

    expect(config.missing).toEqual(['DUES_NOTICES_FROM']);
    expect(config.siteUrl).toBe(SITE);
    expect(config.allowlist).toBeNull();
    expect(config.from).toBe('');
  });

  it('falls back to the council site when the public URL is empty', () => {
    const config = readReportMailConfig({
      RESEND_API_KEY: '',
      DUES_NOTICES_FROM: '',
    });

    expect(config.missing).toEqual(['RESEND_API_KEY', 'DUES_NOTICES_FROM']);
    expect(config.siteUrl).toBe('https://kofc-15256.org');
    expect(config.allowlist).toBeNull();
  });
});

describe('reportEmailBlocker', () => {
  it('names a missing from address before anything else', () => {
    const config = readReportMailConfig({
      ...ready,
      DUES_NOTICES_FROM: '',
    });

    expect(reportEmailBlocker(config, 'fs@example.com')).toBe(
      'Email is not configured (DUES_NOTICES_FROM)',
    );
  });

  it('refuses an account with no email address', () => {
    const config = readReportMailConfig(ready);

    expect(reportEmailBlocker(config, null)).toBe(
      'The signed-in account has no email address',
    );
    expect(reportEmailBlocker(config, '   ')).toBe(
      'The signed-in account has no email address',
    );
  });

  it('refuses a recipient who is not on the allowlist', () => {
    const config = readReportMailConfig(ready);
    const blocked = {
      ...config,
      allowlist: new Set(['other@example.com']),
    };

    expect(reportEmailBlocker(blocked, 'fs@example.com')).toBe(
      'not on EMAIL_ALLOWLIST',
    );
  });

  it('allows the signer when mail is configured and the allowlist is open', () => {
    const config = readReportMailConfig(ready);

    expect(config.allowlist).toBeNull();
    expect(config.apiKey).toBe('re_test');
    expect(config.from).toBe('FS <fs@kofc-15256.org>');
    expect(reportEmailBlocker(config, 'fs@example.com')).toBeNull();
  });
});

describe('sendFinanceReport', () => {
  const config = readReportMailConfig(ready);

  it('returns the Resend error and does not need a packet to fail', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      status: 422,
      statusText: 'Unprocessable',
      json: async () => ({ message: 'nope' }),
    }));

    await expect(
      sendFinanceReport({
        config,
        recipient: 'fs@example.com',
        subject: 'Council worksheet, March 2099',
        html: '<p>hi</p>',
        text: 'hi',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ ok: false, error: 'Resend 422: nope' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: config.from,
      to: ['fs@example.com'],
      subject: 'Council worksheet, March 2099',
      tags: [{ name: 'kind', value: 'finance_report' }],
    });
  });

  it('returns ok when Resend accepts the message', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ id: 'email_1' }),
    }));

    await expect(
      sendFinanceReport({
        config,
        recipient: 'fs@example.com',
        subject: 'Payment packet: Supreme, January 2099',
        html: '<p>hi</p>',
        text: 'hi',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
