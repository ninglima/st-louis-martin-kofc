'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { enhanceAction } from '@kit/next/actions';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentConfigSchema } from '../schemas/payment-config.schema';
import { CreatePaymentSchema } from '../schemas/create-payment.schema';
import { PaymentConfigService } from './payment-config.service';
import { PaymentService } from './payment.service';
import { getPaymentProvider } from '../providers/provider-factory';

export const savePaymentConfigAction = enhanceAction(
  async (data: unknown, user) => {
    const parsed = PaymentConfigSchema.parse(data);
    const adminClient = getSupabaseServerAdminClient();

    const isAdmin = await checkIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      throw new Error('Unauthorized: admin access required');
    }

    const service = new PaymentConfigService(adminClient);
    await service.updateConfig(parsed, user.id);

    revalidatePath('/home/settings/payments');

    return { success: true };
  },
  {},
);

export const testConnectionAction = enhanceAction(
  async (data: { provider: 'stripe' | 'square' }, user) => {
    const adminClient = getSupabaseServerAdminClient();

    const isAdmin = await checkIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      throw new Error('Unauthorized: admin access required');
    }

    const service = new PaymentConfigService(adminClient);
    return service.testConnection(data.provider);
  },
  {},
);

export const createPaymentAction = enhanceAction(
  async (data: unknown, user) => {
    const parsed = CreatePaymentSchema.parse(data);
    const adminClient = getSupabaseServerAdminClient();

    const provider = await getPaymentProvider(adminClient);
    const result = await provider.createPayment({
      ...parsed,
      userId: user.id,
    });

    const configResult = await adminClient
      .from('payment_config')
      .select('active_provider')
      .single();

    const paymentService = new PaymentService(adminClient);
    await paymentService.createPayment({
      ...parsed,
      userId: user.id,
      provider: configResult.data?.active_provider ?? 'square',
      providerPaymentId: result.paymentId,
    });

    return result;
  },
  {},
);

async function checkIsAdmin(
  adminClient: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await adminClient
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  return !!data;
}
