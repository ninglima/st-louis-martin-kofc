import {
  Square,
  SquareClient,
  SquareEnvironment,
  SquareError,
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
    const response = await this.client.payments.create({
      idempotencyKey: params.idempotencyKey,
      sourceId: params.sourceToken,
      amountMoney: {
        amount: BigInt(params.amount),
        currency: (params.currency ?? 'USD').toUpperCase() as Square.Currency,
      },
      locationId: this.locationId,
      referenceId: params.referenceId,
      note: params.note ?? undefined,
    });

    const payment = response.payment;

    return {
      paymentId: payment?.id ?? params.idempotencyKey,
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

/**
 * `errors[0].code` values from Square's `ErrorCode` enum that represent a
 * card being rejected -- as opposed to a request/config problem on our
 * side (bad location id, malformed request, etc). Not exhaustive, just the
 * common decline-shaped codes worth a specific, human sentence.
 */
const CARD_DECLINE_ERROR_CODES = new Set([
  'CARD_DECLINED',
  'CARD_DECLINED_CALL_ISSUER',
  'CARD_DECLINED_VERIFICATION_REQUIRED',
  'CARD_EXPIRED',
  'CARD_NOT_SUPPORTED',
  'CVV_FAILURE',
  'ADDRESS_VERIFICATION_FAILURE',
  'GENERIC_DECLINE',
  'INSUFFICIENT_FUNDS',
  'INVALID_CARD',
  'INVALID_EXPIRATION',
  'INVALID_CARD_DATA',
  'VERIFY_CVV_FAILURE',
  'VERIFY_AVS_FAILURE',
  'PAN_FAILURE',
  'BAD_EXPIRATION',
  'TRANSACTION_LIMIT',
  'PAYMENT_LIMIT_EXCEEDED',
]);

/**
 * `SquareError` (see `square/errors/SquareError.js` in the installed
 * package) builds its thrown `message` as
 * `"Status code: 402\nBody: { \"errors\": [...] }"` -- the pretty-printed
 * API response body. A declined card surfaces as exactly this kind of
 * HTTP error, so that raw message is the most common real failure path a
 * member would otherwise see verbatim. This inspects the SDK's structured
 * `error.errors[0].code` instead and returns a safe, human sentence for
 * recognised decline codes, or `null` for anything unrecognised so the
 * caller can fall back to a generic message.
 */
export function describeSquareChargeError(error: unknown): string | null {
  if (error instanceof SquareError) {
    const code = error.errors[0]?.code;

    if (code && CARD_DECLINE_ERROR_CODES.has(code)) {
      return 'Your card was declined. Please try another card.';
    }
  }

  return null;
}

/**
 * Distinguishes a *definite* charge failure (Square received the request
 * and rejected it -- a 4xx `SquareError`, e.g. a decline or validation
 * error) from an *ambiguous* one (a network timeout via
 * `SquareTimeoutError`, a dropped connection, a 5xx from Square's own
 * infra) where we genuinely don't know whether a charge was created.
 * Callers should only treat the row as safely retryable in-place
 * (reusing the same idempotency key) for the ambiguous case; a definite
 * failure means nothing was charged, so retrying the same row buys
 * nothing and the member should start a fresh payment instead.
 */
export function isDefiniteSquareChargeFailure(error: unknown): boolean {
  return (
    error instanceof SquareError &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}
