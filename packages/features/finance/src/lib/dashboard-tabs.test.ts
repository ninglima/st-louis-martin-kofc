import { describe, expect, it } from 'vitest';

import { DASHBOARD_TABS, parseMonthParam, parseTab } from './dashboard-tabs';

describe('parseTab', () => {
  it('accepts the four tabs', () => {
    expect(DASHBOARD_TABS).toEqual([
      'overview',
      'collection',
      'lapses',
      'retention',
    ]);
    expect(parseTab('lapses')).toBe('lapses');
    expect(parseTab(['retention', 'x'])).toBe('retention');
  });

  it('falls back to overview', () => {
    expect(parseTab(undefined)).toBe('overview');
    expect(parseTab('bogus')).toBe('overview');
    expect(parseTab('')).toBe('overview');
  });
});

describe('parseMonthParam', () => {
  const today = '2040-10-15';

  it('accepts the first of a month in the next twelve months', () => {
    expect(parseMonthParam('2040-10-01', today)).toBe('2040-10-01');
    expect(parseMonthParam('2041-09-01', today)).toBe('2041-09-01');
  });

  it('rejects anything else', () => {
    expect(parseMonthParam(undefined, today)).toBeNull();
    expect(parseMonthParam('2040-10-15', today)).toBeNull();
    expect(parseMonthParam('2041-10-01', today)).toBeNull();
    expect(parseMonthParam('2040-09-01', today)).toBeNull();
    expect(parseMonthParam('2040-13-01', today)).toBeNull();
  });
});
