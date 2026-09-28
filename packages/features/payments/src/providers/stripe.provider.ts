import Stripe from 'stripe';

import type { PaymentProviderInterface } from '../types/payment-provider';
import type { CreatePaymentParams, PaymentResult, PaymentStatus, WebhookEvent } from '../types/payment.types';

export class StripeProvider implements PaymentProviderInterface {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  async createPayment(params: CreatePaymentParams & { userId: string }): Promise<PaymentResult> {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency ?? 'usd',
      // Caller metadata first, our own keys last, so nothing a client sends
      // can relabel whose payment this is or what type it is.
      metadata: {
        ...((params.metadata as Record<string, string>) ?? {}),
        userId: params.userId,
        paymentType: params.payment_type,
      },
      description: params.description ?? undefined,
    });

    return {
      paymentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? undefined,
      status: mapStripeStatus(paymentIntent.status),
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
    return mapStripeStatus(paymentIntent.status);
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(payload: string): Promise<WebhookEvent | null> {
    return mapStripeWebhookEvent(JSON.parse(payload) as Stripe.Event);
  }
}

/**
 * Turns a verified Stripe event into the status write for our `payments`
 * row (keyed by the PaymentIntent id we stored as `provider_payment_id`),
 * or `null` when the event must not change any row.
 *
 * - `payment_intent.*`: the intent's own status, as before.
 * - `charge.refunded`: `refunded` only when the charge is refunded in FULL
 *   (`charge.refunded` is Stripe's own "fully refunded" flag). Resolved to
 *   our row through the charge's `payment_intent`. A partial refund leaves
 *   the status alone (logged) -- dues have no partial-refund meaning, and
 *   `refunded` voids the member's dues period via `kit.payments_dues_sync`.
 * - `charge.refund.updated` / `refund.updated` / `refund.failed` for a
 *   refund that `failed` or was `canceled`: logged at error level for the FS
 *   to reconcile by hand; no status change.
 * - Anything else: ignored. (Previously every event was read as if it were
 *   a PaymentIntent; for any other object the id never matched a row, so
 *   ignoring them changes nothing.)
 */
export function mapStripeWebhookEvent(
  event: Stripe.Event,
): WebhookEvent | null {
  if (event.type.startsWith('payment_intent.')) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    return {
      type: event.type,
      providerPaymentId: paymentIntent.id,
      status: mapStripeStatus(paymentIntent.status),
    };
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      console.warn('Stripe charge.refunded has no payment_intent; ignored.', {
        chargeId: charge.id,
      });
      return null;
    }

    if (!charge.refunded || charge.amount_refunded < charge.amount) {
      console.warn('Stripe partial refund; payment status left unchanged.', {
        chargeId: charge.id,
        paymentIntentId,
        amount: charge.amount,
        amountRefunded: charge.amount_refunded,
      });
      return null;
    }

    return {
      type: event.type,
      providerPaymentId: paymentIntentId,
      status: 'refunded',
    };
  }

  if (
    event.type === 'charge.refund.updated' ||
    event.type === 'refund.updated' ||
    event.type === 'refund.failed'
  ) {
    const refund = event.data.object as Stripe.Refund;

    if (refund.status === 'failed' || refund.status === 'canceled') {
      // The status is left alone: `refunded` is terminal (see
      // `PaymentService.updatePaymentStatus`), so if `charge.refunded`
      // already marked this payment refunded and voided its dues period,
      // only a person can put that right.
      console.error(
        `Stripe refund ${refund.status}; the council may still hold this money. The Financial Secretary must reconcile this payment and its dues period by hand.`,
        {
          paymentIntentId:
            typeof refund.payment_intent === 'string'
              ? refund.payment_intent
              : (refund.payment_intent?.id ?? null),
          refundId: refund.id,
          amount: refund.amount,
        },
      );
    }

    return null;
  }

  return null;
}

function mapStripeStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
  const map: Record<string, PaymentStatus> = {
    requires_payment_method: 'pending',
    requires_confirmation: 'pending',
    requires_action: 'processing',
    processing: 'processing',
    succeeded: 'succeeded',
    canceled: 'cancelled',
    requires_capture: 'processing',
  };
  return map[status] ?? 'pending';
}
