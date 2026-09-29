import { describe, expect, it } from 'vitest';

import {
  gridRange,
  monthGrid,
  parseMonthParam,
  parseViewParam,
  shiftMonth,
} from './calendar';

describe('calendar', () => {
  it('parses ?month= and falls back to the current month', () => {
    expect(parseMonthParam('2040-10', '2026-09-29')).toBe('2040-10');
    expect(parseMonthParam('2040-13', '2026-09-29')).toBe('2026-09');
    expect(parseMonthParam(undefined, '2026-09-29')).toBe('2026-09');
    expect(parseMonthParam(['2041-01', 'x'], '2026-09-29')).toBe('2041-01');
  });

  it('parses ?view=', () => {
    expect(parseViewParam('list')).toBe('list');
    expect(parseViewParam('month')).toBe('month');
    expect(parseViewParam('bogus')).toBe('month');
  });

  it('moves between months across year ends', () => {
    expect(shiftMonth('2040-12', 1)).toBe('2041-01');
    expect(shiftMonth('2041-01', -1)).toBe('2040-12');
  });

  it('builds Sunday-first weeks covering the month', () => {
    // August 2026 starts on a Saturday and needs six weeks.
    const weeks = monthGrid('2026-08', '2026-08-15');

    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]!.date).toBe('2026-07-26');
    expect(weeks[0]![6]).toMatchObject({ date: '2026-08-01', inMonth: true });
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(
      weeks
        .flat()
        .filter((d) => d.isToday)
        .map((d) => d.date),
    ).toEqual(['2026-08-15']);
    expect(gridRange(weeks)).toEqual({ from: '2026-07-26', to: '2026-09-05' });
  });

  it('uses four weeks for a February that starts on Sunday', () => {
    expect(monthGrid('2026-02', '2026-09-29')).toHaveLength(4);
  });
});
