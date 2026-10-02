import { describe, expect, it } from 'vitest';

import {
  RecordPaymentSchema,
  RetireDuesLevelSchema,
  SaveDuesLevelSchema,
  VoidPeriodSchema,
  dollarsToCents,
  priceChangeNotice,
} from './schemas';

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

describe('SaveDuesLevelSchema', () => {
  const level = {
    slug: null,
    name: 'Public Service',
    amount: '20',
    selfService: false,
    sortOrder: '4',
  };

  it('accepts whole dollars and dollars with cents', () => {
    expect(SaveDuesLevelSchema.safeParse(level).success).toBe(true);
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '58.50' }).success,
    ).toBe(true);
  });

  it.each(['$58', '1,000', '58.005', '-1', '', 'abc'])(
    'rejects the amount %j rather than guessing',
    (amount) => {
      expect(SaveDuesLevelSchema.safeParse({ ...level, amount }).success).toBe(
        false,
      );
    },
  );

  it('caps the amount at $1,000', () => {
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '1000' }).success,
    ).toBe(true);
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, amount: '1000.01' }).success,
    ).toBe(false);
  });

  it('trims the name and refuses blank or over-long names', () => {
    const parsed = SaveDuesLevelSchema.parse({ ...level, name: '  Student  ' });
    expect(parsed.name).toBe('Student');
    expect(SaveDuesLevelSchema.safeParse({ ...level, name: '   ' }).success).toBe(
      false,
    );
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, name: 'x'.repeat(81) }).success,
    ).toBe(false);
  });

  it('needs a whole-number order', () => {
    expect(
      SaveDuesLevelSchema.safeParse({ ...level, sortOrder: '2.5' }).success,
    ).toBe(false);
  });
});

describe('dollarsToCents', () => {
  it('converts without floating-point drift', () => {
    expect(dollarsToCents('58')).toBe(5800);
    expect(dollarsToCents('19.99')).toBe(1999);
    expect(dollarsToCents('0.1')).toBe(10);
    expect(dollarsToCents('1000')).toBe(100000);
  });
});

describe('priceChangeNotice', () => {
  it('says a new price applies from now on only when it changed', () => {
    expect(priceChangeNotice(5800, '60')).toBe(
      'Applies to payments made from now on. Recorded dues keep the amount paid.',
    );
    expect(priceChangeNotice(5800, '58.00')).toBeNull();
    expect(priceChangeNotice(null, '58')).toBeNull();
    expect(priceChangeNotice(5800, 'abc')).toBeNull();
  });
});

describe('RetireDuesLevelSchema', () => {
  it('requires a level to move members to when there are any', () => {
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 3,
        moveTo: '',
      }).success,
    ).toBe(false);
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 3,
        moveTo: 'regular',
      }).success,
    ).toBe(true);
  });

  it('needs no target when nobody is on the level', () => {
    expect(
      RetireDuesLevelSchema.safeParse({
        slug: 'honorary',
        memberCount: 0,
        moveTo: '',
      }).success,
    ).toBe(true);
  });
});
