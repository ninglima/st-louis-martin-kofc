import 'server-only';

import {
  isEmailAllowlisted,
  NOT_ON_ALLOWLIST_ERROR,
  parseEmailAllowlist,
} from '@kit/email/allowlist';
import { renderBrandedEmail } from '@kit/email/branded-layout';
import { escapeHtml } from '@kit/email/html';
import { sendEmail } from '@kit/email/resend';
import { formatAmountCents } from '@kit/dues/lib/format-amount';

import { worksheetMonthLabel } from '../lib/worksheet-month';
import type { MonthlyWorksheet, PaymentPacket } from '../types';

const DEFAULT_SITE_URL = 'https://kofc-15256.org';

export interface ReportMailConfig {
  apiKey: string;
  from: string;
  siteUrl: string;
  allowlist: ReadonlySet<string> | null;
  missing: string[];
}

/**
 * NEXT_PUBLIC_SITE_URL is passed as the literal `process.env.NEXT_PUBLIC_SITE_URL`
 * so Next inlines it at build time. A runtime lookup would see the committed
 * localhost value instead of the public origin.
 */
export function readReportMailConfig(
  env: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
): ReportMailConfig {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  const from = env.DUES_NOTICES_FROM?.trim() ?? '';
  const siteUrl =
    (env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, '') ||
    DEFAULT_SITE_URL;

  const missing = (
    [
      ['RESEND_API_KEY', apiKey],
      ['DUES_NOTICES_FROM', from],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    apiKey,
    from,
    siteUrl,
    allowlist: parseEmailAllowlist(env.EMAIL_ALLOWLIST),
    missing,
  };
}

export function reportEmailBlocker(
  config: ReportMailConfig,
  recipient: string | null,
): string | null {
  if (config.missing.length > 0) {
    return `Email is not configured (${config.missing.join(', ')})`;
  }

  if (!recipient?.trim()) {
    return 'The signed-in account has no email address';
  }

  if (!isEmailAllowlisted(recipient, config.allowlist)) {
    return NOT_ON_ALLOWLIST_ERROR;
  }

  return null;
}

function paragraphStyle(): string {
  return 'font-size: 14px; line-height: 24px; margin: 16px 0; color: rgb(0, 0, 0);';
}

function reportsUrl(siteUrl: string): string {
  return `${siteUrl}/home/reports`;
}

function amountOrBlank(cents: number | null): string {
  return cents === null ? 'blank' : formatAmountCents(cents);
}

function renderReport(
  subject: string,
  lines: string[],
  siteUrl: string,
): { subject: string; html: string; text: string } {
  const text = lines.join('\n');
  const bodyHtml = lines
    .filter((line) => line.length > 0)
    .map((line) => `<p style="${paragraphStyle()}">${escapeHtml(line)}</p>`)
    .join('\n');

  const html = renderBrandedEmail({
    title: subject,
    bodyHtml,
    ctaLabel: 'Open reports',
    ctaUrl: reportsUrl(siteUrl),
    preheader: subject,
  });

  return { subject, html, text };
}

export function renderWorksheetReport(
  worksheet: MonthlyWorksheet,
  siteUrl: string,
): { subject: string; html: string; text: string } {
  const subject = `Council worksheet, ${worksheetMonthLabel(worksheet.month)}`;
  const counts = worksheet.statusCounts;

  return renderReport(
    subject,
    [
      subject,
      '',
      `As of ${worksheet.asOf}`,
      `Roster ${worksheet.roster}`,
      `Current ${counts.current}`,
      `Due soon ${counts.due_soon}`,
      `Due ${counts.due}`,
      `Lapsed ${counts.lapsed}`,
      `No record ${counts.no_record}`,
      `Received ${formatAmountCents(worksheet.receivedCents)}`,
      `Card ${formatAmountCents(worksheet.onlineCents)}`,
      `Check ${formatAmountCents(worksheet.checkCents)}`,
      `Cash ${formatAmountCents(worksheet.cashCents)}`,
    ],
    siteUrl,
  );
}

export function renderPacketReport(
  packet: PaymentPacket,
  siteUrl: string,
): { subject: string; html: string; text: string } {
  const subject = `Payment packet: ${packet.label}`;
  const lines = [
    subject,
    '',
    `Supreme ${amountOrBlank(packet.supremeCents)}`,
    `State ${amountOrBlank(packet.stateCents)}`,
  ];

  if (packet.note !== null) {
    lines.push('', `Note: ${packet.note}`);
  }

  return renderReport(subject, lines, siteUrl);
}

export async function sendFinanceReport(args: {
  config: ReportMailConfig;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sent = await sendEmail(
    args.config.apiKey,
    {
      from: args.config.from,
      to: args.recipient,
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: [{ name: 'kind', value: 'finance_report' }],
    },
    { fetchImpl: args.fetchImpl },
  );

  if (!sent.ok) return { ok: false, error: sent.error };

  return { ok: true };
}
