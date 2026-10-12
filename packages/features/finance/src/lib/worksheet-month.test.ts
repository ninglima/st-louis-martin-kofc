import { describe, expect, it } from 'vitest';

import {
  defaultWorksheetMonth,
  worksheetMonthOptions,
} from './worksheet-month';

describe('defaultWorksheetMonth', () => {
  it('is the previous calendar month', () => {
    expect(defaultWorksheetMonth('2026-10-12')).toBe('2026-09-01');
    expect(defaultWorksheetMonth('2026-01-03')).toBe('2025-12-01');
  });

  it('does not go before January 2000', () => {
    expect(defaultWorksheetMonth('2000-01-15')).toBe('2000-01-01');
  });
});

describe('worksheetMonthOptions', () => {
  it('starts at the current month and ends at January 2000', () => {
    const months = worksheetMonthOptions('2000-03-02');

    expect(months[0]).toBe('2000-03-01');
    expect(months.at(-1)).toBe('2000-01-01');
    expect(months).toHaveLength(3);
  });
});
