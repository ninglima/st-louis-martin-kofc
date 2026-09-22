import type {
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookEvent,
} from './payment.types';

export interface ChargeWithTokenParams {
  sourceToken: string;
  amount: number;
  currency?: string;
  note?: string;
  /**
   * A stable key derived from the `payments` row being charged (its `id`)
   * rather than minted fresh per call. If the HTTP response to a charge is
   * lost (timeout, dropped connection) and the same payment is retried,
   * reusing this key lets Square dedupe the retry instead of charging the
   * card twice. Square caps idempotency keys at 45 characters; a row `id`
   * is a UUID (36 chars), so it fits directly.
   */
  idempotencyKey: string;
  /**
   * Links the Square-side payment back to the local row for dashboard
   * reconciliation. Optional only because callers that don't have a row
   * yet (there are none today) would have nothing to pass.
   */
  referenceId?: string;
}

export interface PaymentProviderInterface {
  createPayment(
    params: CreatePaymentParams & { userId: string },
  ): Promise<PaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string): Promise<WebhookEvent>;
  /**
   * Charges a previously tokenized payment source (e.g. a Square Web
   * Payments SDK card token). Optional because providers like Stripe use a
   * different (PaymentIntent + client-side confirmation) flow and never
   * need this method -- the token is confirmed directly against Stripe by
   * the browser, not sent back to our server.
   */
  chargeWithToken?(params: ChargeWithTokenParams): Promise<PaymentResult>;
}
