import { describe, expect, it } from 'vitest';

import {
  fraternalYearLabel,
  fraternalYearOf,
  parseYearParam,
  yearOptions,
} from './fraternal-year';

describe('fraternalYearOf', () => {
  it('starts the year on July 1', () => {
    expect(fraternalYearOf('2027-06-30')).toBe(2026);
    expect(fraternalYearOf('2027-07-01')).toBe(2027);
    expect(fraternalYearOf('2027-01-15')).toBe(2026);
  });
});

describe('parseYearParam', () => {
  const today = '2027-06-30'; // Chicago date late on June 30: still FY2026

  it('defaults to the current fraternal year', () => {
    expect(parseYearParam(undefined, today)).toBe(2026);
    expect(parseYearParam('', today)).toBe(2026);
  });

  it('accepts a year from 2000 to next year', () => {
    expect(parseYearParam('2025', today)).toBe(2025);
    expect(parseYearParam('2027', today)).toBe(2027);
    expect(parseYearParam(['2024', '2025'], today)).toBe(2024);
  });

  it('falls back on anything else', () => {
    expect(parseYearParam('1999', today)).toBe(2026);
    expect(parseYearParam('2028', today)).toBe(2026);
    expect(parseYearParam('20x6', today)).toBe(2026);
  });
});

describe('labels and options', () => {
  it('labels a year as 2026–27', () => {
    expect(fraternalYearLabel(2026)).toBe('2026–27');
    expect(fraternalYearLabel(2099)).toBe('2099–00');
  });

  it('lists years newest first', () => {
    expect(yearOptions(2026, 2024)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(2026, 2030)).toEqual([2026]);
  });
});
