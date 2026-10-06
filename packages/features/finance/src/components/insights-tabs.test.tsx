import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));

// Recharts needs real layout; these tests cover the cards, lists and links around the charts.
vi.mock('./insights-charts', () => ({
  AgingChart: () => null,
  RunningTotalChart: () => null,
  ForecastChart: () => null,
  RetentionRateChart: () => null,
  LapsesByMonthChart: () => null,
}));

import { DashboardTabsNav } from './dashboard-tabs-nav';
import { LapsesTab } from './lapses-tab';
import { CollectionSummary } from './collection-tab';

describe('DashboardTabsNav', () => {
  it('marks the active tab and links each tab', () => {
    const { container } = render(<DashboardTabsNav active="lapses" />);
    const active = container.querySelector(
      '[data-test="dashboard-tab-lapses"]',
    );
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(
      container
        .querySelector('[data-test="dashboard-tab-retention"]')
        ?.getAttribute('href'),
    ).toBe('/home/dashboard?tab=retention');
  });
});

describe('LapsesTab', () => {
  const buckets = [
    { bucket: '1-30' as const, members: 0, cents: 0 },
    { bucket: '31-90' as const, members: 1, cents: 5000 },
    { bucket: '91-180' as const, members: 0, cents: 0 },
    { bucket: '181+' as const, members: 0, cents: 0 },
  ];

  it('shows each bucket and the list', () => {
    const { container } = render(
      <LapsesTab
        buckets={buckets}
        members={[
          {
            memberId: 'm1',
            firstName: 'A',
            lastName: 'B',
            membershipNumber: '1',
            daysUnpaid: 31,
            bucket: '31-90',
            levelName: 'Regular',
            amountCents: 5000,
            lastPaidOn: null,
          },
        ]}
        canOpenMembers={false}
      />,
    );
    expect(
      container.querySelector('[data-test="lapses-bucket-31-90"]')?.textContent,
    ).toContain('1');
    expect(
      container.querySelectorAll('[data-test="lapsed-member-row"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-test="lapsed-member-row"] a'),
    ).toBeNull();
    expect(
      container.querySelector('[data-test="lapses-explanation"]')?.textContent,
    ).toContain('unpaid today, from day 1');
  });

  it('says so when nobody is lapsed', () => {
    const { container } = render(
      <LapsesTab
        buckets={buckets.map((b) => ({ ...b, members: 0, cents: 0 }))}
        members={[]}
        canOpenMembers
      />,
    );
    expect(
      container.querySelector('[data-test="lapsed-members"]')?.textContent,
    ).toContain('No lapsed members');
  });

  it('shows the last notice when one is given for the row', () => {
    const { container } = render(
      <LapsesTab
        buckets={buckets}
        members={[
          {
            memberId: 'm1',
            firstName: 'A',
            lastName: 'B',
            membershipNumber: '1',
            daysUnpaid: 31,
            bucket: '31-90',
            levelName: 'Regular',
            amountCents: 5000,
            lastPaidOn: null,
          },
        ]}
        canOpenMembers={false}
        lastNotices={{
          m1: {
            memberId: 'm1',
            kind: 'after_30',
            sentAt: '2026-10-03T14:00:00Z',
            tracking: 'opened',
          },
        }}
      />,
    );

    const cell = container.querySelector('[data-test="last-notice"]');
    expect(cell?.textContent).toContain('Opened');
  });
});

describe('CollectionSummary', () => {
  it('shows progress and a dash when nothing is expected', () => {
    const { container } = render(
      <CollectionSummary
        progress={{
          expected: 0,
          renewed: 0,
          expectedCents: 0,
          collectedCents: 0,
          byMonth: [],
        }}
      />,
    );
    expect(
      container.querySelector('[data-test="collection-progress"]')?.textContent,
    ).toContain('—');
    expect(
      container.querySelector('[data-test="collection-collected"]')
        ?.textContent,
    ).toContain('$0.00');
  });

  it('shows renewed of expected', () => {
    const { container } = render(
      <CollectionSummary
        progress={{
          expected: 4,
          renewed: 2,
          expectedCents: 23200,
          collectedCents: 12700,
          byMonth: [],
        }}
      />,
    );
    expect(
      container.querySelector('[data-test="collection-progress"]')?.textContent,
    ).toContain('2 of 4');
    expect(
      container.querySelector('[data-test="collection-expected"]')?.textContent,
    ).toContain('$232.00');
  });
});
