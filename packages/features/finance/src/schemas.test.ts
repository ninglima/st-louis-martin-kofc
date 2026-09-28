import { describe, expect, it } from 'vitest';

import { HostingCostFormSchema, toHostingCostInput } from './schemas';

const base = {
  provider: 'supabase',
  amount: '25.00',
  paidOn: '2026-10-01',
  coversFrom: '2026-10-01',
  coversTo: '2026-10-31',
  note: '',
};

describe('HostingCostFormSchema', () => {
  it('accepts a monthly bill and stores an exclusive end', () => {
    const parsed = HostingCostFormSchema.parse(base);
    expect(toHostingCostInput(parsed)).toEqual({
      id: null,
      provider: 'supabase',
      amountCents: 2500,
      paidOn: '2026-10-01',
      periodStart: '2026-10-01',
      periodEnd: '2026-11-01',
      note: null,
    });
  });

  it('accepts a single-day bill', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, coversTo: '2026-10-01' })
        .success,
    ).toBe(true);
  });

  it('rejects a bad amount', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, amount: '12.345' }).success,
    ).toBe(false);
  });

  it('rejects an end before the start', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, coversTo: '2026-09-30' })
        .success,
    ).toBe(false);
  });

  it('rejects more than three years', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, coversTo: '2029-10-05' })
        .success,
    ).toBe(false);
  });

  it('rejects an impossible date', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, paidOn: '2026-02-30' })
        .success,
    ).toBe(false);
  });

  it('rejects dates before 2000', () => {
    const before2000 = HostingCostFormSchema.safeParse({
      ...base,
      paidOn: '1999-12-31',
    });

    expect(before2000.success).toBe(false);
    if (!before2000.success) {
      expect(before2000.error.issues[0]?.message).toBe(
        'Enter a date from 2000 on',
      );
    }

    expect(
      HostingCostFormSchema.safeParse({
        ...base,
        coversFrom: '0026-10-01',
      }).success,
    ).toBe(false);
    expect(
      HostingCostFormSchema.safeParse({
        ...base,
        coversTo: '1999-01-01',
        coversFrom: '1999-01-01',
      }).success,
    ).toBe(false);
  });

  it('accepts the earliest allowed date', () => {
    expect(
      HostingCostFormSchema.safeParse({
        ...base,
        paidOn: '2000-01-01',
        coversFrom: '2000-01-01',
        coversTo: '2000-01-01',
      }).success,
    ).toBe(true);
  });

  it('rejects a long note and trims a short one', () => {
    expect(
      HostingCostFormSchema.safeParse({ ...base, note: 'x'.repeat(501) })
        .success,
    ).toBe(false);
    expect(
      toHostingCostInput(
        HostingCostFormSchema.parse({ ...base, note: '  Pro plan ' }),
      ).note,
    ).toBe('Pro plan');
  });

  it('keeps the id on edit', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      toHostingCostInput(HostingCostFormSchema.parse({ ...base, id })).id,
    ).toBe(id);
  });
});
