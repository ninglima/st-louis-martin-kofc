import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  daysBetween,
  monthlyEquivalentCents,
  nextPeriod,
} from './dates';

describe('dates', () => {
  it('adds days in UTC without DST drift', () => {
    expect(addDaysIso('2027-03-13', 1)).toBe('2027-03-14');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('matches the database rule for the next period', () => {
    expect(nextPeriod('2034-10-01', '2034-11-01')).toEqual({
      start: '2034-11-01',
      end: '2034-12-01',
    });
    expect(nextPeriod('2034-10-01', '2035-10-01')).toEqual({
      start: '2035-10-01',
      end: '2036-10-01',
    });
    expect(nextPeriod('2034-10-16', '2034-11-15')).toEqual({
      start: '2034-11-15',
      end: '2034-12-15',
    });
    expect(nextPeriod('2027-01-31', '2027-02-28')).toEqual({
      start: '2027-02-28',
      end: '2027-03-28',
    });
  });

  it('gives a monthly equivalent', () => {
    expect(monthlyEquivalentCents(2500, '2026-10-01', '2026-11-01')).toBe(2500);
    expect(monthlyEquivalentCents(1200, '2026-10-01', '2027-10-01')).toBe(100);
    expect(monthlyEquivalentCents(3000, '2026-10-16', '2026-11-15')).toBe(3044);
  });
});
