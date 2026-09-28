import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DuesLedgerRow, DuesLevel, MemberDuesSummary } from '../types';
import { MemberDuesCard } from './member-dues-card';

vi.mock('../server/dues-actions', () => ({
  setAcceptedOnAction: vi.fn(),
  setDuesLevelAction: vi.fn(),
  setStudentAction: vi.fn(),
  recordDuesPaymentAction: vi.fn(),
  voidDuesPeriodAction: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const LEVELS: DuesLevel[] = [
  {
    slug: 'regular_full',
    name: 'Regular',
    amountCents: 5800,
    selfService: true,
  },
  {
    slug: 'regular_contrib',
    name: 'Contributing',
    amountCents: 2000,
    selfService: true,
  },
];

function summary(
  overrides: Partial<MemberDuesSummary> = {},
): MemberDuesSummary {
  return {
    memberId: '6f1c1b1e-1111-4111-8111-111111111111',
    duesLevel: 'regular_full',
    levelName: 'Regular',
    amountCents: 5800,
    acceptedOn: '2026-01-01',
    isStudent: false,
    paidThrough: null,
    duesStatus: 'due',
    ...overrides,
  };
}

function ledgerRow(overrides: Partial<DuesLedgerRow> = {}): DuesLedgerRow {
  return {
    id: '6f1c1b1e-2222-4111-8111-111111111111',
    level: 'regular_full',
    levelName: 'Regular',
    amountCents: 5800,
    method: 'check',
    checkNumber: '1042',
    receivedOn: '2026-01-01',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    recordedByEmail: 'fs@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function render(
  options: {
    summaryOverrides?: Partial<MemberDuesSummary>;
    ledger?: DuesLedgerRow[];
    canManage?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <MemberDuesCard
      summary={summary(options.summaryOverrides)}
      ledger={options.ledger ?? []}
      levels={LEVELS}
      canManage={options.canManage ?? false}
      memberId="6f1c1b1e-1111-4111-8111-111111111111"
      memberName="Jane Member"
    />,
  );
}

describe('MemberDuesCard', () => {
  it('carries the required data-test hooks', () => {
    const html = render();

    expect(html).toContain('data-test="dues-card"');
    expect(html).toContain('data-test="dues-status"');
    expect(html).toContain('data-test="dues-paid-through"');
  });

  it('shows an em dash for a member with no paid-through date, never "null"', () => {
    const html = render({ summaryOverrides: { paidThrough: null } });

    const section = html.slice(html.indexOf('data-test="dues-paid-through"'));
    expect(section.slice(0, 200)).toContain('—');
    expect(html).not.toContain('null');
  });

  it('shows the real paid-through date when there is one', () => {
    const html = render({ summaryOverrides: { paidThrough: '2027-03-14' } });

    expect(html).toContain('2027-03-14');
  });

  it('formats the level price as dollars and cents', () => {
    const html = render();

    expect(html).toContain('$58.00');
  });

  it('prices the header off summary.amountCents, even for a level not in the active list', () => {
    // A member left on a deactivated level: `levels` (only active ones) has
    // no entry for it, so a lookup-based price would go missing even though
    // `summary.amountCents` already carries the right number.
    const html = render({
      summaryOverrides: {
        duesLevel: 'retired_level',
        levelName: 'Retired Level',
        amountCents: 999,
      },
    });

    expect(html).toContain('$9.99');
    expect(html).toContain('Retired Level');
  });

  it('hides every management control without canManage', () => {
    const html = render({ canManage: false });

    expect(html).not.toContain('data-test="record-payment-open"');
    expect(html).not.toContain('data-test="set-accepted-on-input"');
    expect(html).not.toContain('data-test="dues-student-switch"');
  });

  it('offers Record payment and the level/student controls with canManage', () => {
    const html = render({ canManage: true });

    expect(html).toContain('data-test="record-payment-open"');
    expect(html).toContain('data-test="dues-student-switch"');
    expect(html).toContain('data-test="dues-level-select"');
  });

  it('offers the accepted-on input only when the ledger has no active period', () => {
    const withActive = render({
      canManage: true,
      ledger: [ledgerRow({ voidedAt: null })],
    });
    const withoutActive = render({
      canManage: true,
      ledger: [ledgerRow({ voidedAt: '2026-02-01T00:00:00Z' })],
    });

    expect(withActive).not.toContain('data-test="set-accepted-on-input"');
    expect(withoutActive).toContain('data-test="set-accepted-on-input"');
  });

  it('renders one ledger-row per payment, active and voided alike', () => {
    const html = render({
      ledger: [
        ledgerRow({ id: 'a', voidedAt: null }),
        ledgerRow({ id: 'b', voidedAt: '2026-02-01T00:00:00Z' }),
      ],
    });

    expect(html.split('data-test="ledger-row"').length - 1).toBe(2);
  });

  it('strikes through a voided row and shows its reason, without a void button', () => {
    const html = render({
      canManage: true,
      ledger: [
        ledgerRow({
          id: 'voided-one',
          voidedAt: '2026-02-01T00:00:00Z',
          voidReason: 'duplicate entry',
        }),
      ],
    });

    expect(html).toContain('line-through');
    expect(html).toContain('duplicate entry');
    expect(html).not.toContain('data-test="void-period"');
  });

  it('offers void-period on an active row when canManage, never when read-only', () => {
    const managed = render({
      canManage: true,
      ledger: [ledgerRow({ voidedAt: null })],
    });
    const readOnly = render({
      canManage: false,
      ledger: [ledgerRow({ voidedAt: null })],
    });

    expect(managed).toContain('data-test="void-period"');
    expect(readOnly).not.toContain('data-test="void-period"');
  });

  it('shows the check number alongside the method', () => {
    const html = render({
      ledger: [ledgerRow({ method: 'check', checkNumber: '1042' })],
    });

    expect(html).toContain('Check #1042');
  });

  it('gives the empty actions column header an sr-only label', () => {
    const html = render({ canManage: true });

    expect(html).toContain('sr-only');
    expect(html).toContain('Actions');
  });

  it("names each Void button with that row's covered period", () => {
    const html = render({
      canManage: true,
      ledger: [
        ledgerRow({
          voidedAt: null,
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
        }),
      ],
    });

    expect(html).toContain('aria-label="Void period 2026-01-01 → 2026-12-31"');
  });

  it('does not show the level-change confirmation dialog until a new level is picked', () => {
    // `AlertDialog` is always in the tree (Base UI mounts its Popup lazily
    // while closed), so the confirm/cancel hooks must not leak into a
    // fresh render before the FS has touched the Select.
    const html = render({ canManage: true });

    expect(html).not.toContain('data-test="dues-level-confirm"');
  });
});
