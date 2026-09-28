import { describe, expect, it } from 'vitest';

import { isForecastMonthOutOfRangeError } from './forecast-month-error';

describe('isForecastMonthOutOfRangeError', () => {
  it('is true for a P0001 error', () => {
    expect(isForecastMonthOutOfRangeError({ code: 'P0001' })).toBe(true);
  });

  it('is false for a different Postgres error code', () => {
    expect(isForecastMonthOutOfRangeError({ code: '42501' })).toBe(false);
  });

  it('is false for a missing-schema code', () => {
    expect(isForecastMonthOutOfRangeError({ code: 'PGRST202' })).toBe(false);
  });

  it('is false for errors with no code', () => {
    expect(isForecastMonthOutOfRangeError(new Error('boom'))).toBe(false);
  });

  it('is false for non-object values', () => {
    expect(isForecastMonthOutOfRangeError('P0001')).toBe(false);
    expect(isForecastMonthOutOfRangeError(null)).toBe(false);
    expect(isForecastMonthOutOfRangeError(undefined)).toBe(false);
  });
});
