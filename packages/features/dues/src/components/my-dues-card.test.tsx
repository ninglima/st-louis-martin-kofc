import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { MyDuesSummary, MyLedgerRow } from '../types';
import { MyDuesCard } from './my-dues-card';

function summary(overrides: Partial<MyDuesSummary> = {}): MyDuesSummary {
  return {
    memberId: '6f1c1b1e-1111-4111-8111-111111111111',
    duesLevel: 'regular_full',
    levelName: 'Regular',
    amountCents: 5800,
    acceptedOn: '2026-01-01',
    isStudent: false,
    paidThrough: null,
    duesStatus: 'due',
    levelSelfService: true,
    levelActive: true,
    ...overrides,
  };
}

function ledgerRow(overrides: Partial<MyLedgerRow> = {}): MyLedgerRow {
  return {
    id: '6f1c1b1e-2222-4111-8111-111111111111',
    level_name: 'Regular',
    amount_cents: 5800,
    method: 'check',
    received_on: '2026-01-01',
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    voided_at: null,
    ...overrides,
  };
}

describe('MyDuesCard', () => {
  it('carries the required data-test hook', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard summary={summary()} ledger={[]} />,
    );

    expect(html).toContain('data-test="my-dues"');
  });

  it('says "No dues recorded yet" with no paid-through date, never "null"', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard summary={summary({ paidThrough: null })} ledger={[]} />,
    );

    const section = html.slice(
      html.indexOf('data-test="my-dues-paid-through"'),
    );
    expect(section.slice(0, 200)).toContain('No dues recorded yet');
    expect(html).not.toContain('null');
  });

  it('shows the real paid-through date when there is one', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard
        summary={summary({ paidThrough: '2027-03-14' })}
        ledger={[]}
      />,
    );

    expect(html).toContain('Paid through 2027-03-14');
  });

  it('shows the level and its price', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard summary={summary()} ledger={[]} />,
    );

    expect(html).toContain('Regular');
    expect(html).toContain('$58.00');
  });

  it.each(['due', 'lapsed', 'due_soon', 'no_record'] as const)(
    'offers a Pay dues link to /home/checkout when the status is %s',
    (duesStatus) => {
      const html = renderToStaticMarkup(
        <MyDuesCard summary={summary({ duesStatus })} ledger={[]} />,
      );

      expect(html).toContain('data-test="my-dues-pay-link"');
      expect(html).toContain('href="/home/checkout"');
    },
  );

  it('hides the Pay dues link when the status is current', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard summary={summary({ duesStatus: 'current' })} ledger={[]} />,
    );

    expect(html).not.toContain('data-test="my-dues-pay-link"');
  });

  it('shows "No dues recorded yet" in the ledger when it is empty', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard summary={summary()} ledger={[]} />,
    );

    expect(html).toContain('data-test="my-dues-ledger-empty"');
  });

  it('renders one ledger row per payment, with its period, method and amount', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard
        summary={summary()}
        ledger={[
          ledgerRow({
            id: 'a',
            period_start: '2026-01-01',
            period_end: '2026-12-31',
          }),
        ]}
      />,
    );

    expect(html.split('data-test="my-dues-ledger-row"').length - 1).toBe(1);
    expect(html).toContain('2026-01-01');
    expect(html).toContain('2026-12-31');
    expect(html).toContain('Check');
    expect(html).toContain('$58.00');
  });

  it('strikes through a voided row, without a void reason -- the narrow row carries none', () => {
    const html = renderToStaticMarkup(
      <MyDuesCard
        summary={summary()}
        ledger={[ledgerRow({ voided_at: '2026-02-01T00:00:00Z' })]}
      />,
    );

    expect(html).toContain('line-through');
  });
});
