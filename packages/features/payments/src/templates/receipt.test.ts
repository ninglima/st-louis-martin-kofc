import { describe, expect, it } from 'vitest';

import { renderReceipt } from './receipt';

const base = {
  firstName: 'Nick',
  amountCents: 5800,
  paymentType: 'dues' as const,
  description: 'Annual dues — Regular',
  provider: 'stripe',
  providerPaymentId: 'pi_abc',
  paidAt: '2026-10-06T14:00:00.000Z',
  siteUrl: 'https://portal.example.org',
};

describe('renderReceipt', () => {
  it('renders a branded dues receipt with amount and reference', () => {
    const { subject, html, text } = renderReceipt(base);

    expect(subject).toBe('Payment receipt — Council dues');
    expect(text).toContain('Dear Nick,');
    expect(text).toContain('$58.00');
    expect(text).toContain('Annual dues — Regular');
    expect(text).toContain('pi_abc');
    expect(text).toContain('https://portal.example.org/home/payments');
    expect(html).toContain('Payment receipt — Council dues');
    expect(html).toContain('$58.00');
    expect(html).toContain('View payments');
    expect(html).toContain('https://portal.example.org/home/payments');
  });

  it('uses donation and event fee subjects', () => {
    expect(renderReceipt({ ...base, paymentType: 'donation' }).subject).toBe(
      'Donation receipt',
    );
    expect(renderReceipt({ ...base, paymentType: 'event_fee' }).subject).toBe(
      'Event fee receipt',
    );
  });

  it('falls back when there is no first name', () => {
    const { text } = renderReceipt({ ...base, firstName: null });

    expect(text).toContain('Dear Brother Knight,');
  });

  it('omits description and reference when absent', () => {
    const { text } = renderReceipt({
      ...base,
      description: null,
      providerPaymentId: null,
    });

    expect(text).not.toContain('Description:');
    expect(text).not.toContain('Reference:');
  });
});
