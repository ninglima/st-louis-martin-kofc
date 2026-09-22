import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PaymentConfigFormValues } from '../schemas/payment-config.schema';
import type { PaymentConfig } from '../types/payment.types';

type PaymentsClient = SupabaseClient<Database>;

export class PaymentConfigService {
  constructor(private adminClient: PaymentsClient) {}

  async getConfig(): Promise<PaymentConfig> {
    const { data, error } = await this.adminClient
      .from('payment_config')
      .select('*')
      .single();

    if (error || !data) {
      throw new Error('Payment configuration not found');
    }

    return data as PaymentConfig;
  }

  async updateConfig(values: PaymentConfigFormValues, userId: string): Promise<PaymentConfig> {
    const { data, error } = await this.adminClient
      .from('payment_config')
      .update({
        active_provider: values.active_provider,
        stripe_publishable_key: values.stripe_publishable_key || null,
        stripe_secret_key: values.stripe_secret_key || null,
        stripe_webhook_secret: values.stripe_webhook_secret || null,
        square_application_id: values.square_application_id || null,
        square_access_token: values.square_access_token || null,
        square_location_id: values.square_location_id || null,
        square_webhook_signature_key: values.square_webhook_signature_key || null,
        environment: values.environment,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', 1)
      .select()
      .single();

    if (error || !data) {
      throw new Error('Failed to update payment configuration');
    }

    return data as PaymentConfig;
  }

  async testConnection(provider: 'stripe' | 'square'): Promise<{ success: boolean; message: string }> {
    const config = await this.getConfig();

    if (provider === 'stripe') {
      if (!config.stripe_secret_key) {
        return { success: false, message: 'Stripe secret key is not configured' };
      }
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(config.stripe_secret_key);
        await stripe.paymentMethods.list({ limit: 1 });
        return { success: true, message: 'Stripe connection successful' };
      } catch (e) {
        return { success: false, message: `Stripe connection failed: ${(e as Error).message}` };
      }
    }

    if (!config.square_access_token) {
      return { success: false, message: 'Square access token is not configured' };
    }
    try {
      const { SquareClient, SquareEnvironment } = await import('square');
      const client = new SquareClient({
        token: config.square_access_token,
        environment: config.environment === 'sandbox' ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
      });
      await client.locations.list();
      return { success: true, message: 'Square connection successful' };
    } catch (e) {
      return { success: false, message: `Square connection failed: ${(e as Error).message}` };
    }
  }
}
