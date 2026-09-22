import {
  Square,
  SquareClient,
  SquareEnvironment,
  WebhooksHelper,
} from 'square';
import { randomUUID } from 'crypto';

import type {
  ChargeWithTokenParams,
  PaymentProviderInterface,
} from '../types/payment-provider';
import type {
  CreatePaymentParams,
  PaymentResult,
  PaymentStatus,
  WebhookEvent,
} from '../types/payment.types';

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
      environment: sandbox
        ? SquareEnvironment.Sandbox
        : SquareEnvironment.Production,
    });
    this.locationId = locationId;
    this.webhookSignatureKey = webhookSignatureKey;
    this.notificationUrl = notificationUrl ?? '';
  }

  /**
   * Square's Web Payments SDK only produces a card token client-side, after
   * the browser has rendered the card form -- there is no token yet at the
   * point `createPayment` runs (it is what creates the local `payments` row
   * the client then attaches a token to). So this must NOT call the Square
   * API: doing so previously used `sourceId: 'EXTERNAL'`, which records a
   * payment taken *outside* Square (e.g. cash) rather than actually
   * charging a card -- the member's card was never charged. The real charge
   * happens in `chargeWithToken` once the client has a token.
   */
  async createPayment(
    _params: CreatePaymentParams & { userId: string },
  ): Promise<PaymentResult> {
    const idempotencyKey = randomUUID();

    return {
      paymentId: idempotencyKey,
      status: 'pending',
    };
  }

  async chargeWithToken(params: ChargeWithTokenParams): Promise<PaymentResult> {
    const idempotencyKey = randomUUID();

    const response = await this.client.payments.create({
      idempotencyKey,
      sourceId: params.sourceToken,
      amountMoney: {
        amount: BigInt(params.amount),
        currency: (params.currency ?? 'USD').toUpperCase() as Square.Currency,
      },
      locationId: this.locationId,
      note: params.note ?? undefined,
    });

    const payment = response.payment;

    return {
      paymentId: payment?.id ?? idempotencyKey,
      status: mapSquareStatus(payment?.status),
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const response = await this.client.payments.get({
      paymentId: providerPaymentId,
    });
    return mapSquareStatus(response.payment?.status);
  }

  async verifyWebhookSignature(
    payload: string,
    signature: string,
  ): Promise<boolean> {
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
