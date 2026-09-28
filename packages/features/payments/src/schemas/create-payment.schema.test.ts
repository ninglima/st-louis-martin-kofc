import { describe, expect, it } from 'vitest';

import { CreatePaymentSchema } from './create-payment.schema';

describe('CreatePaymentSchema', () => {
  it('dues need a level and drop any amount', () => {
    const parsed = CreatePaymentSchema.parse({
      payment_type: 'dues',
      level: 'regular',
      amount: 1,
      currency: 'usd',
    });
    expect(parsed).toMatchObject({ payment_type: 'dues', level: 'regular' });
    expect('amount' in parsed).toBe(false);
    expect(
      CreatePaymentSchema.safeParse({ payment_type: 'dues' }).success,
    ).toBe(false);
  });

  it('donations need a positive amount', () => {
    expect(
      CreatePaymentSchema.safeParse({
        payment_type: 'donation',
        amount: 2500,
        currency: 'usd',
      }).success,
    ).toBe(true);
    expect(
      CreatePaymentSchema.safeParse({
        payment_type: 'donation',
        amount: 0,
        currency: 'usd',
      }).success,
    ).toBe(false);
  });
});
