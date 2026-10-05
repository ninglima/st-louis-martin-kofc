import { describe, expect, it } from 'vitest';

import { daysBetween, formatDueDate, inDays, isPayable } from './dues-display';

describe('formatDueDate', () => {
  it('spells out the month without shifting the day', () => {
    // Parsed as a plain calendar date: a `new Date('2027-08-01')` read in
    // Chicago time would show July 31.
    expect(formatDueDate('2027-08-01')).toBe('August 1, 2027');
  });
});

describe('isPayable', () => {
  it('offers payment to everyone who may owe dues', () => {
    expect(isPayable('due')).toBe(true);
    expect(isPayable('lapsed')).toBe(true);
    expect(isPayable('due_soon')).toBe(true);
    expect(isPayable('no_record')).toBe(true);
  });

  it('offers nothing to a member who is current', () => {
    expect(isPayable('current')).toBe(false);
  });
});

describe('daysBetween and inDays', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-10-02', '2026-11-13')).toBe(42);
    expect(inDays(42)).toBe('in 42 days');
    expect(inDays(1)).toBe('tomorrow');
    expect(inDays(0)).toBe('today');
  });
});
