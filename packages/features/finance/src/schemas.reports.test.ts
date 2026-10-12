import { describe, expect, it } from 'vitest';

import { PaymentPacketFormSchema, toPaymentPacketCents } from './schemas';

describe('PaymentPacketFormSchema', () => {
  it('accepts a Supreme total alone, including zero', () => {
    const parsed = PaymentPacketFormSchema.parse({
      label: 'Supreme, January 2027',
      supreme: '0',
      state: '',
    });

    expect(toPaymentPacketCents(parsed)).toEqual({
      supremeCents: 0,
      stateCents: null,
    });
  });

  it('accepts dollars and cents', () => {
    const parsed = PaymentPacketFormSchema.parse({
      label: 'State',
      supreme: '',
      state: '12.50',
    });

    expect(toPaymentPacketCents(parsed).stateCents).toBe(1250);
  });

  it.each([
    [
      { label: 'x', supreme: '', state: '' },
      'Enter a Supreme or a state total',
    ],
    [
      { label: 'x', supreme: '-1', state: '' },
      'Enter an amount like 25 or 25.00',
    ],
    [
      { label: 'x', supreme: '1.234', state: '' },
      'Enter an amount like 25 or 25.00',
    ],
    [{ label: '   ', supreme: '1', state: '' }, 'Enter a label'],
  ])('refuses %j', (input, message) => {
    const result = PaymentPacketFormSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message === message),
      ).toBe(true);
    }
  });
});
