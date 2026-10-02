import type { PaymentStatus } from '../types/payment.types';

/** One badge colour per payment status, shared by the payment history table
 * and the member home's payments card. */
export const PAYMENT_STATUS_VARIANTS: Record<
  PaymentStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  pending: 'outline',
  processing: 'secondary',
  succeeded: 'default',
  failed: 'destructive',
  refunded: 'secondary',
  cancelled: 'destructive',
};
