import { describe, expect, it } from 'vitest';

import {
  BUCKET_LABELS,
  hasCollectedDues,
  monthYearHeading,
  progressLabel,
  toAgingChartData,
  toForecastChartData,
  toLapsesByMonthData,
  toRetentionRateData,
  toRunningTotalData,
} from './insights-data';

describe('insights data', () => {
  it('labels progress', () => {
    expect(progressLabel(0, 0)).toBe('—');
    expect(progressLabel(2, 4)).toBe('50%');
  });

  it('keeps blank future months in the running total', () => {
    expect(
      toRunningTotalData(
        [
          { month: '2040-07-01', cents: 0, cumulativeCents: 0 },
          { month: '2040-08-01', cents: 10800, cumulativeCents: 10800 },
          { month: '2040-11-01', cents: 0, cumulativeCents: null },
        ],
        23200,
      ),
    ).toEqual([
      { month: 'Jul', collected: 0, expected: 232 },
      { month: 'Aug', collected: 108, expected: 232 },
      { month: 'Nov', collected: null, expected: 232 },
    ]);
    expect(toRunningTotalData([], 0)).toEqual([]);
  });

  it('labels forecast months with the year and keeps the key', () => {
    expect(
      toForecastChartData([{ month: '2041-01-01', members: 3, cents: 17400 }]),
    ).toEqual([
      { key: '2041-01-01', month: "Jan '41", members: 3, dollars: 174 },
    ]);
  });

  it('maps buckets to readable labels', () => {
    expect(BUCKET_LABELS['181+']).toBe('181+ days');
    expect(
      toAgingChartData([{ bucket: '1-30', members: 2, cents: 11600 }]),
    ).toEqual([{ bucket: '1–30 days', members: 2, dollars: 116 }]);
  });

  it('computes renewal rates and leaves empty years blank', () => {
    expect(
      toRetentionRateData([
        { year: 2038, eligible: 4, renewed: 2 },
        { year: 2039, eligible: 0, renewed: 0 },
      ]),
    ).toEqual([
      { year: '2038–39', rate: 50, eligible: 4, renewed: 2 },
      { year: '2039–40', rate: null, eligible: 0, renewed: 0 },
    ]);
  });

  it('labels lapse months', () => {
    expect(toLapsesByMonthData([{ month: '2038-11-01', lapses: 2 }])).toEqual([
      { month: "Nov '38", lapses: 2 },
    ]);
  });

  it('tells whether any dues were actually collected', () => {
    expect(hasCollectedDues([])).toBe(false);
    expect(
      hasCollectedDues([
        { month: '2040-07-01', cents: 0, cumulativeCents: 0 },
        { month: '2040-08-01', cents: 0, cumulativeCents: null },
      ]),
    ).toBe(false);
    expect(
      hasCollectedDues([
        { month: '2040-07-01', cents: 0, cumulativeCents: 0 },
        { month: '2040-08-01', cents: 10800, cumulativeCents: 10800 },
      ]),
    ).toBe(true);
  });

  it('formats a full month and year for the drill-down heading', () => {
    expect(monthYearHeading('2026-10-01')).toBe('October 2026');
    expect(monthYearHeading('2026-01-01')).toBe('January 2026');
  });
});
