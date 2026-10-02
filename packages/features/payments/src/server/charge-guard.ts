import { DUES_LEVEL_METADATA_KEY } from '@kit/dues/lib/payment-metadata';
import type { DuesLevel } from '@kit/dues/types';

import { MIN_OPEN_AMOUNT_CENTS } from '../schemas/create-payment.schema';

/** The columns of a `payments` row that decide whether it may be charged. */
export interface ChargeablePaymentRow {
  user_id: string;
  status: string;
  amount: number;
  payment_type: string;
  metadata: unknown;
}

export const CHARGE_REFUSALS = {
  notOwner: 'You do not have permission to confirm this payment.',
  notPending: 'This payment has already been processed.',
  belowMinimum: 'This payment is below the $0.50 minimum.',
  duesMismatch:
    'This dues payment no longer matches its dues level. Please start again from checkout.',
} as const;

/**
 * Re-checks a `payments` row immediately before `confirmSquarePaymentAction`
 * charges a card for it. Returns the reason to refuse, or `null` to charge.
 *
 * `createPaymentAction` already enforces all of this when it creates the
 * row. The row is re-checked here anyway because it is read back from the
 * database, and the database is not the action: a row that did not come
 * from `createPaymentAction` must never be charged just because it exists.
 * That includes a row a member inserted directly before
 * `20260928130000_payments_no_member_insert` revoked the grant, or one
 * written by a future code path. Checks:
 *
 * - it belongs to the caller;
 * - it is still `pending`;
 * - it is at least `MIN_OPEN_AMOUNT_CENTS` (the card-testing floor);
 * - for dues, its amount equals the CURRENT price of the active level named
 *   in `metadata.dues_level`. Deliberately stricter than
 *   `kit.record_online_dues_period`, which judges the level as of the
 *   payment's creation: this guard compares to the price NOW, so a row
 *   created before a price change is not charged at the stale price, and
 *   anything charged here is one the trigger accepts.
 *
 * `loadDuesLevels` (active levels) is called only for a dues row that
 * passed the other checks.
 */
export async function refuseToCharge(
  payment: ChargeablePaymentRow,
  userId: string,
  loadDuesLevels: () => Promise<DuesLevel[]>,
): Promise<string | null> {
  if (payment.user_id !== userId) {
    return CHARGE_REFUSALS.notOwner;
  }

  if (payment.status !== 'pending') {
    return CHARGE_REFUSALS.notPending;
  }

  if (
    !Number.isInteger(payment.amount) ||
    payment.amount < MIN_OPEN_AMOUNT_CENTS
  ) {
    return CHARGE_REFUSALS.belowMinimum;
  }

  if (payment.payment_type !== 'dues') {
    return null;
  }

  const slug = duesLevelOf(payment.metadata);
  const level = slug
    ? (await loadDuesLevels()).find((candidate) => candidate.slug === slug)
    : undefined;

  if (!level || level.amountCents !== payment.amount) {
    return CHARGE_REFUSALS.duesMismatch;
  }

  return null;
}

function duesLevelOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[DUES_LEVEL_METADATA_KEY];

  return typeof value === 'string' && value !== '' ? value : null;
}
