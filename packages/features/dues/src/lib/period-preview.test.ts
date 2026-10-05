import { describe, expect, it } from 'vitest';

import { addDaysIso, periodPreview } from './period-preview';

describe('addDaysIso', () => {
  it('crosses the 2028 leap day correctly', () => {
    // 2028 is a leap year, so the 365 days after 2027-03-15 fall one day
    // short of 2028-03-15 -- the extra day (Feb 29) is inside the span.
    expect(addDaysIso('2027-03-15', 365)).toBe('2028-03-14');
  });

  it('adds a plain 365 days across two non-leap years', () => {
    // Neither 2025 nor 2026 is a leap year, so 365 days from Jan 1 lands
    // exactly on the next Jan 1 -- the boring case the leap-day one is
    // contrasted against.
    expect(addDaysIso('2025-01-01', 365)).toBe('2026-01-01');
  });

  it('does not drift across a DST transition', () => {
    // America/Chicago falls back in early November. A local-time `Date`
    // mutated with `setDate` (not `setUTCDate`) can land on the wrong day
    // here if the offset shifts mid-calculation; the UTC-only math cannot.
    expect(addDaysIso('2026-10-01', 40)).toBe('2026-11-10');
  });
});

describe('periodPreview', () => {
  it('starts from the paid-through date when there is one', () => {
    expect(periodPreview('2027-03-15', '2020-01-01')).toEqual({
      start: '2027-03-15',
      end: '2028-03-14',
    });
  });

  it('falls back to the acceptance date when there is no paid-through date', () => {
    expect(periodPreview(null, '2027-03-15')).toEqual({
      start: '2027-03-15',
      end: '2028-03-14',
    });
  });

  it('is null with neither date -- nothing to preview yet', () => {
    expect(periodPreview(null, null)).toBeNull();
  });
});
