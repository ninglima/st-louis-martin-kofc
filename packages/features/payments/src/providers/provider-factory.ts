import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PaymentProviderInterface } from '../types/payment-provider';
import type {
  PaymentConfig,
  PublicPaymentConfig,
} from '../types/payment.types';
import { StripeProvider } from './stripe.provider';
import { SquareProvider } from './square.provider';

type PaymentsClient = SupabaseClient<Database>;

export async function getPaymentProvider(
  adminClient: PaymentsClient,
): Promise<PaymentProviderInterface> {
  const config = await getPaymentConfig(adminClient);

  if (config.active_provider === 'stripe') {
    if (!config.stripe_secret_key) {
      throw new Error('Stripe secret key is not configured');
    }
    return new StripeProvider(
      config.stripe_secret_key,
      config.stripe_webhook_secret ?? '',
    );
  }

  if (!config.square_access_token || !config.square_location_id) {
    throw new Error('Square access token and location ID are required');
  }
  return new SquareProvider(
    config.square_access_token,
    config.square_location_id,
    config.square_webhook_signature_key ?? '',
    config.environment === 'sandbox',
  );
}

export async function getPaymentConfig(
  adminClient: PaymentsClient,
): Promise<PaymentConfig> {
  const { data, error } = await adminClient
    .from('payment_config')
    .select('*')
    .single();

  if (error || !data) {
    throw new Error('Payment configuration not found');
  }

  return data as PaymentConfig;
}

export async function getPublicPaymentConfig(
  adminClient: PaymentsClient,
): Promise<PublicPaymentConfig> {
  const config = await getPaymentConfig(adminClient);

  return {
    activeProvider: config.active_provider,
    publishableKey:
      config.active_provider === 'stripe'
        ? config.stripe_publishable_key
        : config.square_application_id,
    locationId: config.square_location_id,
    environment: config.environment,
  };
}
