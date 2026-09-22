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

  async updatePaymentStatus(
    adminClient: PaymentsClient,
    providerPaymentId: string,
    status: PaymentStatus,
  ): Promise<void> {
    const { error } = await adminClient
      .from('payments')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_payment_id', providerPaymentId);

    if (error) {
      throw new Error(`Failed to update payment status: ${error.message}`);
    }
  }
}
