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
      metadata: {
        userId: params.userId,
        paymentType: params.payment_type,
        ...(params.metadata as Record<string, string> ?? {}),
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

  async parseWebhookEvent(payload: string): Promise<WebhookEvent> {
    const event = JSON.parse(payload) as Stripe.Event;
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    return {
      type: event.type,
      providerPaymentId: paymentIntent.id,
      status: mapStripeStatus(paymentIntent.status),
    };
  }
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
