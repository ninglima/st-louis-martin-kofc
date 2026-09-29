import { describe, expect, it } from 'vitest';

import { checkoutOutcome } from './checkout-outcome';

describe('checkoutOutcome', () => {
  it('reads Stripe redirect_status values', () => {
    expect(checkoutOutcome('succeeded')).toBe('succeeded');
    expect(checkoutOutcome('processing')).toBe('processing');
    // A bank account waiting on micro-deposit verification.
    expect(checkoutOutcome('requires_action')).toBe('processing');
    expect(checkoutOutcome('requires_payment_method')).toBe('failed');
    expect(checkoutOutcome('failed')).toBe('failed');
    expect(checkoutOutcome('canceled')).toBe('failed');
  });

  it('reads the Square form statuses', () => {
    expect(checkoutOutcome('cancelled')).toBe('failed');
  });

  it('treats a missing or unknown value as succeeded, the page it replaces', () => {
    expect(checkoutOutcome(undefined)).toBe('succeeded');
    expect(checkoutOutcome('banana')).toBe('succeeded');
    expect(checkoutOutcome(['processing', 'x'])).toBe('processing');
  });
});
