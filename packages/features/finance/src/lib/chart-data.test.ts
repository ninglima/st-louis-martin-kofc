import { describe, expect, it } from 'vitest';

import {
  collectionRateLabel,
  monthLabel,
  toDuesChartData,
  toHostingChartData,
  toNetChartData,
  toStatusChartData,
} from './chart-data';

describe('chart data', () => {
  it('labels the collection rate', () => {
    expect(collectionRateLabel(0, 0)).toBe('—');
    expect(collectionRateLabel(2, 3)).toBe('67%');
    expect(collectionRateLabel(3, 3)).toBe('100%');
  });

  it('labels months', () => {
    expect(monthLabel('2026-07-01')).toBe('Jul');
    expect(monthLabel('2027-01-01')).toBe('Jan');
  });

  it('turns dues rows into dollars', () => {
    expect(
      toDuesChartData([
        {
          month: '2026-07-01',
          onlineCents: 5800,
          checkCents: 5000,
          cashCents: 0,
        },
      ]),
    ).toEqual([{ month: 'Jul', online: 58, check: 50, cash: 0 }]);
    expect(toDuesChartData([])).toEqual([]);
  });

  it('pivots hosting by provider over twelve months', () => {
    const data = toHostingChartData(
      [
        { month: '2026-10-01', provider: 'supabase', cents: 2500 },
        { month: '2026-10-01', provider: 'domain', cents: 102 },
      ],
      [
        { slug: 'supabase', name: 'Supabase' },
        { slug: 'domain', name: 'Domain' },
      ],
      2026,
    );
    expect(data).toHaveLength(12);
    expect(data[3]).toEqual({ month: 'Oct', supabase: 25, domain: 1.02 });
    expect(data[0]).toEqual({ month: 'Jul', supabase: 0, domain: 0 });
  });

  it('orders status counts for the chart', () => {
    expect(
      toStatusChartData({
        current: 3,
        due_soon: 1,
        due: 2,
        lapsed: 4,
        no_record: 0,
      }).map((r) => r.status),
    ).toEqual(['current', 'due_soon', 'due', 'lapsed', 'no_record']);
  });

  it('computes net per year in dollars', () => {
    expect(
      toNetChartData([{ year: 2026, duesCents: 10000, hostingCents: 2500 }]),
    ).toEqual([{ year: '2026–27', dues: 100, hosting: 25, net: 75 }]);
  });

  it('computes dues-only data per year when hosting is hidden', () => {
    expect(
      toNetChartData(
        [{ year: 2026, duesCents: 10000, hostingCents: 2500 }],
        false,
      ),
    ).toEqual([{ year: '2026–27', dues: 100 }]);
  });
});
