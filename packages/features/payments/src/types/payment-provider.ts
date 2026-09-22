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
