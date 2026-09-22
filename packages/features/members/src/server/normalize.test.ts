import { describe, expect, it } from 'vitest';

import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from './normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    // The real extract is full of addresses like this.
    expect(normalizeEmail('  PABRAHAM@PJILAW.COM ')).toBe(
      'pabraham@pjilaw.com',
    );
  });

  it('returns null for blank', () => {
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('formats a ten-digit US number', () => {
    expect(normalizePhone('7034774236')).toBe('(703) 477-4236');
  });

  it('strips punctuation before formatting', () => {
    expect(normalizePhone('703.477.4236')).toBe('(703) 477-4236');
  });

  it('drops a leading country code', () => {
    expect(normalizePhone('+1 703 477 4236')).toBe('(703) 477-4236');
  });

  it('leaves a non-US-shaped number unformatted rather than mangling it', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('returns null for blank', () => {
    expect(normalizePhone('')).toBeNull();
  });
});

describe('normalizeState', () => {
  it('uppercases a valid state', () => {
    expect(normalizeState('va')).toBe('VA');
  });

  it('returns null for something that is not a state', () => {
    expect(normalizeState('Virginia')).toBeNull();
    expect(normalizeState('ZZ')).toBeNull();
  });
});

describe('normalizeZip', () => {
  it('preserves ZIP+4, which the whole sample uses', () => {
    expect(normalizeZip('20147-3067')).toBe('20147-3067');
  });

  it('preserves a five-digit ZIP', () => {
    expect(normalizeZip('20147')).toBe('20147');
  });
});

describe('normalizeName', () => {
  it('trims but does not touch case', () => {
    // The sample contains "Iii" where "III" was meant. Silently correcting
    // it would be guessing; the officer fixes it at source.
    expect(normalizeName('  Iii ')).toBe('Iii');
  });
});
