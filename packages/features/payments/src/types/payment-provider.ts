import type { CreatePaymentParams, PaymentResult, PaymentStatus, WebhookEvent } from './payment.types';

export interface PaymentProviderInterface {
  createPayment(params: CreatePaymentParams & { userId: string }): Promise<PaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string): Promise<WebhookEvent>;
}
