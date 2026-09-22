import { Square, SquareClient, SquareEnvironment, WebhooksHelper } from 'square';
import { randomUUID } from 'crypto';

import type { PaymentProviderInterface } from '../types/payment-provider';
import type { CreatePaymentParams, PaymentResult, PaymentStatus, WebhookEvent } from '../types/payment.types';

export class SquareProvider implements PaymentProviderInterface {
  private client: SquareClient;
  private locationId: string;
  private webhookSignatureKey: string;
  private notificationUrl: string;

  constructor(
    accessToken: string,
    locationId: string,
    webhookSignatureKey: string,
    sandbox: boolean,
    notificationUrl?: string,
  ) {
    this.client = new SquareClient({
      token: accessToken,
      environment: sandbox ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
    });
    this.locationId = locationId;
    this.webhookSignatureKey = webhookSignatureKey;
    this.notificationUrl = notificationUrl ?? '';
  }

  async createPayment(params: CreatePaymentParams & { userId: string }): Promise<PaymentResult> {
    const idempotencyKey = randomUUID();

    const response = await this.client.payments.create({
      idempotencyKey,
      sourceId: 'EXTERNAL',
      amountMoney: {
        amount: BigInt(params.amount),
        currency: (params.currency ?? 'USD').toUpperCase() as Square.Currency,
      },
      locationId: this.locationId,
      referenceId: params.userId,
      note: params.description ?? undefined,
      externalDetails: {
        type: 'OTHER',
        source: 'KofC Online Payment',
      },
    });

    const payment = response.payment;

    return {
      paymentId: payment?.id ?? idempotencyKey,
      status: mapSquareStatus(payment?.status),
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const response = await this.client.payments.get({ paymentId: providerPaymentId });
    return mapSquareStatus(response.payment?.status);
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    if (!this.webhookSignatureKey) return false;

    return WebhooksHelper.verifySignature({
      requestBody: payload,
      signatureHeader: signature,
      signatureKey: this.webhookSignatureKey,
      notificationUrl: this.notificationUrl,
    });
  }

  async parseWebhookEvent(payload: string): Promise<WebhookEvent> {
    const event = JSON.parse(payload) as {
      type: string;
      data: { object: { payment?: { id: string; status: string } } };
    };

    const payment = event.data?.object?.payment;

    return {
      type: event.type,
      providerPaymentId: payment?.id ?? '',
      status: mapSquareStatus(payment?.status),
    };
  }
}

function mapSquareStatus(status: string | undefined): PaymentStatus {
  const map: Record<string, PaymentStatus> = {
    APPROVED: 'processing',
    COMPLETED: 'succeeded',
    CANCELED: 'cancelled',
    FAILED: 'failed',
    PENDING: 'pending',
  };
  return map[status ?? ''] ?? 'pending';
}
