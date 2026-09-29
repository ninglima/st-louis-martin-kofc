import { describe, expect, it } from 'vitest';

import { toMessage } from './errors';

describe('toMessage', () => {
  it('maps database errors to readable text', () => {
    expect(toMessage({ code: '42501', message: 'forbidden' })).toBe(
      'You do not have permission to do that.',
    );
    expect(toMessage({ code: 'P0001', message: 'This shift is full.' })).toBe(
      'This shift is full.',
    );
    expect(toMessage({ code: '22P02', message: 'bad uuid' })).toBe(
      'Some of the details are not valid.',
    );
    expect(toMessage(new Error('boom'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
