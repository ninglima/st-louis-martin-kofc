import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DuesAndPaymentsView } from '../lib/dues-and-payments';
import { DuesAndPaymentsCard } from './dues-and-payments-card';

const base: DuesAndPaymentsView = {
  tone: 'action',
  badge: { label: 'Renewal due', variant: 'outline' },
  headline: 'Your dues are ready to renew',
  detail: 'Your last dues term ended August 1, 2026 · $58.00',
  note: null,
  action: { label: 'Renew dues', href: '/home/checkout' },
  secondary: [],
  yearLine: 'No payments since July 1',
};

const render = (view: DuesAndPaymentsView) =>
  renderToStaticMarkup(<DuesAndPaymentsCard view={view} />);

describe('DuesAndPaymentsCard', () => {
  it('leads with the badge, headline and detail, and the one action', () => {
    const html = render(base);

    expect(html).toContain('Dues &amp; payments');
    expect(html).toContain('Renewal due');
    expect(html).toContain('data-test="dues-payments-headline"');
    expect(html).toContain('Your dues are ready to renew');
    expect(html).toContain('Your last dues term ended August 1, 2026 · $58.00');
    expect(html).toContain('data-test="dues-payments-action"');
    expect(html).toContain('Renew dues');
    expect(html).toContain('href="/home/checkout"');
    expect(html).toContain('data-tone="action"');
  });

  it('never colours anything destructive', () => {
    const html = render({
      ...base,
      secondary: [
        {
          id: 'p1',
          status: 'failed',
          text: "Your $25.00 donation payment on Oct 1 didn't go through",
          retry: true,
        },
      ],
    });

    // The UI kit's base classes mention `destructive` for aria-invalid
    // states; what must never appear is a destructive fill, text or edge.
    expect(html).not.toMatch(
      /bg-destructive\/10|text-destructive|border-l-destructive/,
    );
  });

  it('lists secondary payments with a status badge, and a retry link only for a failure', () => {
    const html = render({
      ...base,
      secondary: [
        {
          id: 'p1',
          status: 'refunded',
          text: '$58.00 dues payment refunded on Oct 2',
          retry: false,
        },
        {
          id: 'p2',
          status: 'failed',
          text: "Your $25.00 donation payment on Oct 1 didn't go through",
          retry: true,
        },
      ],
    });

    expect(html.split('data-test="dues-payments-secondary"').length - 1).toBe(
      2,
    );
    expect(html).toContain('data-status="refunded"');
    expect(html).toContain('$58.00 dues payment refunded on Oct 2');
    expect(html.split('data-test="dues-payments-retry"').length - 1).toBe(1);
  });

  it('shows the note when there is one', () => {
    const html = render({ ...base, note: 'If you have already paid…' });

    expect(html).toContain('data-test="dues-payments-note"');
  });

  it('has no action button when nothing is asked of the member', () => {
    const html = render({ ...base, tone: 'ok', action: null });

    expect(html).not.toContain('data-test="dues-payments-action"');
    expect(html).toContain('data-tone="ok"');
  });

  it('ends with the year line and the one payment history link', () => {
    const html = render(base);

    expect(html).toContain('No payments since July 1');
    expect(html.split('href="/home/payments"').length - 1).toBe(1);
  });
});
