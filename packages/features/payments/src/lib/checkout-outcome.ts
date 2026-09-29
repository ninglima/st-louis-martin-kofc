export type CheckoutOutcome = 'succeeded' | 'processing' | 'failed';

/**
 * What the page a member lands on after paying should say, from the
 * `redirect_status` Stripe appends to its return URL, or the status the
 * Square form passes along. Display only: dues are recorded from the
 * provider's webhook, never from this value.
 *
 * `processing` is a bank (ACH) payment that is still clearing, which takes
 * up to about four business days.
 */
export function checkoutOutcome(
  value: string | string[] | undefined,
): CheckoutOutcome {
  const status = Array.isArray(value) ? value[0] : value;

  switch (status) {
    case 'processing':
    // A bank account waiting on micro-deposit verification.
    case 'requires_action':
      return 'processing';
    case 'failed':
    case 'requires_payment_method':
    case 'canceled':
    case 'cancelled':
      return 'failed';
    default:
      return 'succeeded';
  }
}
