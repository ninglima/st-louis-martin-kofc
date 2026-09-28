import { describe, expect, it } from 'vitest';

import { RecordPaymentSchema, VoidPeriodSchema } from './schemas';

const base = {
  memberId: '6f1c1b1e-1111-4111-8111-111111111111',
  level: 'regular_contrib',
  // Fixed and safely in the past (today, per the environment, is
  // 2026-09-28): RecordPaymentSchema rejects a future received_on (see
  // below), so a fixture shared with the "accepts" tests cannot be a date
  // that might already have passed by the time this suite runs.
  receivedOn: '2026-09-01',
};

describe('RecordPaymentSchema', () => {
  it('accepts cash and waived without a check number', () => {
    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'cash' }).success,
    ).toBe(true);
    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'waived' }).success,
    ).toBe(true);
  });

  it('requires a check number for checks', () => {
    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'check' }).success,
    ).toBe(false);
    expect(
      RecordPaymentSchema.safeParse({
        ...base,
        method: 'check',
        checkNumber: ' 1042 ',
      }).data?.checkNumber,
    ).toBe('1042');
  });

  it('never accepts an amount or online/opening_balance', () => {
    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'online' }).success,
    ).toBe(false);
    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'opening_balance' })
        .success,
    ).toBe(false);
    expect(
      'amount' in
        (RecordPaymentSchema.parse({
          ...base,
          method: 'cash',
          amount: 1,
        }) as object),
    ).toBe(false);
  });

  it('rejects impossible dates', () => {
    expect(
      RecordPaymentSchema.safeParse({
        ...base,
        method: 'cash',
        receivedOn: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('rejects a received date in the future', () => {
    // Two UTC days ahead is enough margin past "today" in America/Chicago
    // (UTC-5/UTC-6) regardless of when in the day this test runs, without
    // hard-coding a date that would itself become the past.
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 2);
    const receivedOn = future.toISOString().slice(0, 10);

    expect(
      RecordPaymentSchema.safeParse({ ...base, method: 'cash', receivedOn })
        .success,
    ).toBe(false);
  });
});

describe('VoidPeriodSchema', () => {
  it('requires a non-blank reason', () => {
    expect(
      VoidPeriodSchema.safeParse({ periodId: base.memberId, reason: '   ' })
        .success,
    ).toBe(false);
  });
});
