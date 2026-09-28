import { describe, expect, it, vi } from 'vitest';

import type { DuesLevel } from '@kit/dues/types';

import {
  CHARGE_REFUSALS,
  type ChargeablePaymentRow,
  refuseToCharge,
} from './charge-guard';

const USER = 'user-1';

const LEVELS: DuesLevel[] = [
  { slug: 'regular', name: 'Regular', amountCents: 5000, selfService: true },
  { slug: 'student', name: 'Student', amountCents: 2500, selfService: false },
];

function row(overrides: Partial<ChargeablePaymentRow> = {}) {
  return {
    user_id: USER,
    status: 'pending',
    amount: 2500,
    payment_type: 'donation',
    metadata: {},
    ...overrides,
  };
}

const levels = async () => LEVELS;

describe('refuseToCharge', () => {
  it('allows a pending donation of the caller at the minimum', async () => {
    await expect(
      refuseToCharge(row({ amount: 50 }), USER, levels),
    ).resolves.toBeNull();
  });

  it("refuses another member's row", async () => {
    await expect(
      refuseToCharge(row({ user_id: 'someone-else' }), USER, levels),
    ).resolves.toBe(CHARGE_REFUSALS.notOwner);
  });

  it.each(['processing', 'succeeded', 'failed', 'refunded', 'cancelled'])(
    'refuses a %s row',
    async (status) => {
      await expect(refuseToCharge(row({ status }), USER, levels)).resolves.toBe(
        CHARGE_REFUSALS.notPending,
      );
    },
  );

  it.each([1, 49, 0, 49.5])(
    'refuses %s cents (below the $0.50 floor or not whole cents)',
    async (amount) => {
      await expect(
        refuseToCharge(
          row({ amount, payment_type: 'event_fee' }),
          USER,
          levels,
        ),
      ).resolves.toBe(CHARGE_REFUSALS.belowMinimum);
    },
  );

  it('does not read dues levels for a non-dues row', async () => {
    const load = vi.fn(levels);

    await refuseToCharge(row(), USER, load);

    expect(load).not.toHaveBeenCalled();
  });

  it('allows a dues row whose amount equals its level price', async () => {
    await expect(
      refuseToCharge(
        row({
          payment_type: 'dues',
          amount: 5000,
          metadata: { dues_level: 'regular' },
        }),
        USER,
        levels,
      ),
    ).resolves.toBeNull();
  });

  it.each([
    ['a price other than the level', 2500, { dues_level: 'regular' }],
    ['dollars instead of cents', 50, { dues_level: 'regular' }],
    ['an unknown or inactive level', 5000, { dues_level: 'platinum' }],
    ['no dues_level key', 5000, {}],
    ['a non-string dues_level', 5000, { dues_level: ['regular'] }],
    ['null metadata', 5000, null],
  ])('refuses a dues row with %s', async (_label, amount, metadata) => {
    await expect(
      refuseToCharge(
        row({ payment_type: 'dues', amount, metadata }),
        USER,
        levels,
      ),
    ).resolves.toBe(CHARGE_REFUSALS.duesMismatch);
  });

  it('checks ownership before reading any level', async () => {
    const load = vi.fn(levels);

    await refuseToCharge(
      row({ user_id: 'someone-else', payment_type: 'dues', amount: 5000 }),
      USER,
      load,
    );

    expect(load).not.toHaveBeenCalled();
  });
});
