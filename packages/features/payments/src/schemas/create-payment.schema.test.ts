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

  it('donations and event fees must be whole cents, at least 50', () => {
    for (const payment_type of ['donation', 'event_fee'] as const) {
      const parse = (amount: number) =>
        CreatePaymentSchema.safeParse({
          payment_type,
          amount,
          currency: 'usd',
        });

      expect(parse(49).success).toBe(false);
      expect(parse(50.5).success).toBe(false);
      expect(parse(50).success).toBe(true);
    }
  });
});
