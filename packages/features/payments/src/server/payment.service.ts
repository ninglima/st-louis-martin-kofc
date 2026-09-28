import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type { CreatePaymentParams, Payment, PaymentItem, PaymentStatus } from '../types/payment.types';

type PaymentsClient = SupabaseClient<Database>;

export class PaymentService {
  constructor(private client: PaymentsClient) {}

  async createPayment(
    params: CreatePaymentParams & { userId: string; provider: string; providerPaymentId?: string },
  ): Promise<Payment> {
    const { data, error } = await this.client
      .from('payments')
      .insert({
        user_id: params.userId,
        provider: params.provider,
        provider_payment_id: params.providerPaymentId ?? null,
        amount: params.amount,
        currency: params.currency ?? 'usd',
        status: 'pending' as PaymentStatus,
        payment_type: params.payment_type,
        description: params.description ?? null,
        // Zod-validated from a JSON request body, so JSON-safe by construction
        metadata: (params.metadata ?? {}) as Json,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create payment: ${error?.message}`);
    }

    if (params.items?.length) {
      await this.client.from('payment_items').insert(
        params.items.map((item) => ({
          payment_id: data.id,
          item_type: item.item_type,
          description: item.description,
          amount: item.amount,
        })),
      );
    }

    return data as Payment;
  }

  async getPayments(userId: string, isAdmin: boolean): Promise<Payment[]> {
    let query = this.client
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch payments: ${error.message}`);
    }

    return (data ?? []) as Payment[];
  }

  async getPaymentItems(paymentId: string): Promise<PaymentItem[]> {
    const { data, error } = await this.client
      .from('payment_items')
      .select('*')
      .eq('payment_id', paymentId);

    if (error) {
      throw new Error(`Failed to fetch payment items: ${error.message}`);
    }

    return (data ?? []) as PaymentItem[];
  }

  /**
   * A plain UPDATE of `payments.status`, so the `AFTER UPDATE OF status`
   * trigger `kit.payments_dues_sync` fires: `succeeded` records the dues
   * period, `refunded` voids it.
   *
   * - `refunded` is terminal here: a late or replayed success event (a
   *   Stripe PaymentIntent stays `succeeded` after a refund) must not move
   *   the row back out of it.
   * - `onlyIfAmount` restricts the write to a row with that exact amount
   *   (see `WebhookEvent.onlyIfAmount`).
   *
   * Because `refunded` is terminal, a refund that later fails or is
   * reversed leaves the row at `refunded` with its dues period voided. The
   * webhook mappers log those events at error level (see
   * `mapStripeWebhookEvent` / `mapSquareWebhookEvent`) for the FS to
   * reconcile by hand.
   */
  async updatePaymentStatus(
    adminClient: PaymentsClient,
    providerPaymentId: string,
    status: PaymentStatus,
    options: { onlyIfAmount?: number } = {},
  ): Promise<void> {
    let query = adminClient
      .from('payments')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_payment_id', providerPaymentId);

    if (status !== 'refunded') {
      query = query.neq('status', 'refunded');
    }

    if (options.onlyIfAmount !== undefined) {
      query = query.eq('amount', options.onlyIfAmount);
    }

    const { data, error } = await query.select('id');

    if (error) {
      throw new Error(`Failed to update payment status: ${error.message}`);
    }

    if (status === 'refunded' && (data ?? []).length === 0) {
      await this.explainUnmatchedRefund(
        adminClient,
        providerPaymentId,
        options.onlyIfAmount,
      );
    }
  }

  /** Tells a partial refund (filtered out on purpose) from an unknown one. */
  private async explainUnmatchedRefund(
    adminClient: PaymentsClient,
    providerPaymentId: string,
    onlyIfAmount: number | undefined,
  ): Promise<void> {
    if (onlyIfAmount !== undefined) {
      const { data: existing } = await adminClient
        .from('payments')
        .select('id, amount')
        .eq('provider_payment_id', providerPaymentId);

      const payment = existing?.[0];

      if (payment) {
        console.warn('Partial refund ignored; payment status unchanged.', {
          providerPaymentId,
          paymentId: payment.id,
          amount: payment.amount,
          refundAmount: onlyIfAmount,
        });
        return;
      }
    }

    console.warn('Refund matched no payment; nothing marked refunded.', {
      providerPaymentId,
      onlyIfAmount,
    });
  }
}
