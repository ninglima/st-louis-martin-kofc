import { describe, expect, it } from 'vitest';

import { parseDuesFilter } from './dues-filter';

/**
 * Moved out of `members-list.test.tsx` when `parseDuesFilter` itself moved
 * out of `members-list.tsx` -- see the doc comment on `dues-filter.ts` for
 * why: calling it from `apps/portal/app/home/members/page.tsx` (a Server
 * Component) crashed every time a caller with `finance.view` opened
 * `/home/members`, because the function used to live in a `'use client'`
 * file.
 */
describe('parseDuesFilter', () => {
  it('accepts each of the five dues statuses', () => {
    for (const status of [
      'current',
      'due_soon',
      'due',
      'lapsed',
      'no_record',
    ]) {
      expect(parseDuesFilter(status)).toBe(status);
    }
  });

  it('ignores anything that is not a real dues status', () => {
    expect(parseDuesFilter('bogus')).toBe('all');
    expect(parseDuesFilter('')).toBe('all');
    expect(parseDuesFilter('Due')).toBe('all');
  });
});
