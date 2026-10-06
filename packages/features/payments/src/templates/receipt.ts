import { renderBrandedEmail } from '@kit/email/branded-layout';
import { escapeHtml } from '@kit/email/html';
import { formatAmountCents } from '@kit/dues/lib/format-amount';

import type { PaymentType } from '../types/payment.types';

export interface ReceiptTemplateInput {
  firstName: string | null;
  amountCents: number;
  paymentType: PaymentType;
  description: string | null;
  provider: string;
  providerPaymentId: string | null;
  paidAt: string;
  siteUrl: string;
}

function subjectFor(paymentType: PaymentType): string {
  switch (paymentType) {
    case 'dues':
      return 'Payment receipt — Council dues';
    case 'donation':
      return 'Donation receipt';
    case 'event_fee':
      return 'Event fee receipt';
  }
}

function typeLabel(paymentType: PaymentType): string {
  switch (paymentType) {
    case 'dues':
      return 'Council dues';
    case 'donation':
      return 'Donation';
    case 'event_fee':
      return 'Event fee';
  }
}

function paragraphStyle(): string {
  return 'font-size: 14px; line-height: 24px; margin: 16px 0; color: rgb(0, 0, 0);';
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Dear ${name},` : 'Dear Brother Knight,';
}

function formatPaidAt(iso: string): string {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return iso;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export function renderReceipt(
  input: ReceiptTemplateInput,
): { subject: string; html: string; text: string } {
  const subject = subjectFor(input.paymentType);
  const amount = formatAmountCents(input.amountCents);
  const label = typeLabel(input.paymentType);
  const paidOn = formatPaidAt(input.paidAt);
  const historyUrl = `${input.siteUrl}/home/payments`;
  const hello = greeting(input.firstName);

  const lines = [
    `Thank you. We received your ${label.toLowerCase()} payment of ${amount}.`,
    ...(input.description ? [`Description: ${input.description}`] : []),
    `Date: ${paidOn}`,
    ...(input.providerPaymentId
      ? [`Reference: ${input.providerPaymentId} (${input.provider})`]
      : []),
  ];

  const text = [
    hello,
    '',
    ...lines,
    '',
    `View payments: ${historyUrl}`,
  ].join('\n');

  const bodyHtml = [
    `<p style="${paragraphStyle()}">${escapeHtml(hello)}</p>`,
    ...lines.map(
      (l) => `<p style="${paragraphStyle()}">${escapeHtml(l)}</p>`,
    ),
  ].join('\n');

  const html = renderBrandedEmail({
    title: subject,
    bodyHtml,
    ctaLabel: 'View payments',
    ctaUrl: historyUrl,
    preheader: subject,
  });

  return { subject, html, text };
}
