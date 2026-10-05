import { describe, expect, it } from 'vitest';

import { centsToDollarsInput, parseDollarsToCents } from './money';

describe('parseDollarsToCents', () => {
  it.each([
    ['25', 2500],
    ['25.5', 2550],
    ['25.50', 2550],
    ['0.10', 10],
    ['$1,200.50', 120050],
    [' 12 ', 1200],
    ['0', 0],
    ['9,999,999.99', 999_999_999],
  ])('%s -> %i cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each([
    '',
    'abc',
    '1e3',
    '-5',
    '12.345',
    '1,2,00',
    '$',
    '10000000',
    '10,000,000.00',
    '999,999,999.99',
  ])('rejects %s', (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe('centsToDollarsInput', () => {
  it('formats cents for an input box', () => {
    expect(centsToDollarsInput(2550)).toBe('25.50');
    expect(centsToDollarsInput(5)).toBe('0.05');
  });
});
