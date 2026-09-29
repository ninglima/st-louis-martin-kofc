import { describe, expect, it } from 'vitest';

import { chicagoDate, chicagoTime, formatTimeRange } from './format';

describe('format', () => {
  it('dates an 11:30 pm Chicago event on its Chicago day, not the UTC day', () => {
    expect(chicagoDate('2040-10-14T04:30:00Z')).toBe('2040-10-13');
  });

  it('gives local clock times for form defaults', () => {
    expect(chicagoTime('2040-10-13T14:00:00Z')).toBe('09:00');
    expect(chicagoTime('2040-11-05T15:00:00Z')).toBe('09:00');
  });

  it('formats a time range', () => {
    expect(
      formatTimeRange('2040-10-13T14:00:00Z', '2040-10-13T16:30:00Z'),
    ).toBe('9:00 AM – 11:30 AM');
  });
});
