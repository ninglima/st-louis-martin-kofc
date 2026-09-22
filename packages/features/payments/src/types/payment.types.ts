export type PaymentProvider = 'stripe' | 'square';
export type PaymentType = 'dues' | 'donation' | 'event_fee';
export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled';
export type PaymentEnvironment = 'sandbox' | 'production';

export interface PaymentConfig {
  id: number;
  active_provider: PaymentProvider;
  stripe_publishable_key: string | null;
  stripe_secret_key: string | null;
  stripe_webhook_secret: string | null;
  square_application_id: string | null;
  square_access_token: string | null;
  square_location_id: string | null;
  square_webhook_signature_key: string | null;
  environment: PaymentEnvironment;
  updated_at: string | null;
  updated_by: string | null;
}

export interface Payment {
  id: string;
  user_id: string;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_type: PaymentType;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PaymentItem {
  id: string;
  payment_id: string;
  item_type: string;
  description: string;
  amount: number;
  created_at: string;
}

export interface CreatePaymentParams {
  amount: number;
  currency?: string;
  payment_type: PaymentType;
  description?: string;
  metadata?: Record<string, unknown>;
  items?: Array<{
    item_type: string;
    description: string;
    amount: number;
  }>;
}

export interface PaymentResult {
  paymentId: string;
  clientSecret?: string;
  checkoutUrl?: string;
  status: PaymentStatus;
}

export interface WebhookEvent {
  type: string;
  providerPaymentId: string;
  status: PaymentStatus;
  metadata?: Record<string, unknown>;
}

export interface PublicPaymentConfig {
  activeProvider: PaymentProvider;
  publishableKey: string | null;
  /**
   * The Square location id. Required client-side by the Square Web Payments
   * SDK to initialize `Square.payments(applicationId, locationId)` -- it is
   * not a secret, only `square_access_token` and the webhook signature key
   * are. Null/unused when `activeProvider` is `stripe`.
   */
  locationId: string | null;
  environment: PaymentEnvironment;
}
