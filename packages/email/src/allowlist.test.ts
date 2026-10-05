import { describe, expect, it } from 'vitest';

import {
  isEmailAllowlisted,
  parseEmailAllowlist,
} from './allowlist';

describe('parseEmailAllowlist', () => {
  it('returns null when unset or blank', () => {
    expect(parseEmailAllowlist(undefined)).toBeNull();
    expect(parseEmailAllowlist('')).toBeNull();
    expect(parseEmailAllowlist('  ,  , ')).toBeNull();
  });

  it('parses a comma-separated list case-insensitively', () => {
    const list = parseEmailAllowlist(' Nick@X.org , a@b.com ');
    expect(list).toEqual(new Set(['nick@x.org', 'a@b.com']));
  });
});

describe('isEmailAllowlisted', () => {
  it('allows every address when the list is null', () => {
    expect(isEmailAllowlisted('anyone@x.org', null)).toBe(true);
  });

  it('matches case-insensitively against a non-empty list', () => {
    const list = parseEmailAllowlist('Nick@X.org');
    expect(isEmailAllowlisted('nick@x.org', list)).toBe(true);
    expect(isEmailAllowlisted('other@x.org', list)).toBe(false);
  });
});
