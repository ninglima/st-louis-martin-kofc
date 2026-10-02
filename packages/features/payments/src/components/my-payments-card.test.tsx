import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { MyPaymentsSummary } from '../lib/my-payments';
import { MyPaymentsCard } from './my-payments-card';

const quiet: MyPaymentsSummary = {
  tone: 'ok',
  attention: [],
  yearCount: 0,
  yearTotalCents: 0,
  yearStart: '2026-07-01',
};

describe('MyPaymentsCard', () => {
  it('says there are no payments this year when there is nothing at all', () => {
    const html = renderToStaticMarkup(<MyPaymentsCard summary={quiet} />);

    expect(html).toContain('data-test="my-payments"');
    expect(html).toContain('No payments this year.');
    expect(html).not.toContain('data-test="my-payments-attention"');
  });

  it('rolls succeeded payments into one line since July 1', () => {
    const html = renderToStaticMarkup(
      <MyPaymentsCard
        summary={{ ...quiet, yearCount: 3, yearTotalCents: 17400 }}
      />,
    );

    expect(html).toContain('3 payments · $174.00 since July 1');
  });

  it('says "1 payment", not "1 payments"', () => {
    const html = renderToStaticMarkup(
      <MyPaymentsCard
        summary={{ ...quiet, yearCount: 1, yearTotalCents: 5800 }}
      />,
    );

    expect(html).toContain('1 payment · $58.00 since July 1');
  });

  it('lists each payment needing a word with its status badge, and a retry only for a failure', () => {
    const html = renderToStaticMarkup(
      <MyPaymentsCard
        summary={{
          ...quiet,
          tone: 'owed',
          attention: [
            {
              id: 'a',
              status: 'processing',
              text: 'Payment processing — $58.00 dues, started Oct 2',
              retry: false,
            },
            {
              id: 'b',
              status: 'failed',
              text: 'Your $15.00 event fee payment on Oct 1 failed',
              retry: true,
            },
          ],
        }}
      />,
    );

    expect(html.split('data-test="my-payments-attention"').length - 1).toBe(2);
    expect(html).toContain('data-status="processing"');
    expect(html).toContain('Payment processing — $58.00 dues, started Oct 2');
    expect(html).toContain('data-status="failed"');
    expect(html.split('data-test="my-payments-retry"').length - 1).toBe(1);
    expect(html).toContain('href="/home/checkout"');
    expect(html).toContain('data-tone="owed"');
  });

  it('links to the payment history', () => {
    const html = renderToStaticMarkup(<MyPaymentsCard summary={quiet} />);

    expect(html).toContain('data-test="my-payments-history"');
    expect(html).toContain('href="/home/payments"');
  });
});
