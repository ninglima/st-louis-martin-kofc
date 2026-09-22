'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { hasPermission } from '@kit/rbac/types';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentConfigSchema } from '../schemas/payment-config.schema';
import { CreatePaymentSchema } from '../schemas/create-payment.schema';
import { PaymentConfigService } from './payment-config.service';
import { PaymentService } from './payment.service';
import { getPaymentProvider } from '../providers/provider-factory';

/**
 * Next.js redacts thrown Server Action error messages in production builds
 * ("The specific message is omitted in production builds to avoid leaking
 * sensitive details" -- see `next/dist/server/app-render/create-error-handler`).
 * So authorization failures below are returned, never thrown, matching the
 * pattern in `role-actions.ts`.
 */
export type ActionResult =
  | { success: true }
  | { success: false; error: string };

const UNAUTHORIZED_MESSAGE =
  'You do not have permission to manage payment settings.';

async function assertCanManagePaymentSettings(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'payment_settings', 'manage')) {
    return { authorized: false as const };
  }

  return { authorized: true as const, client };
}

async function assertCanCheckout(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  return hasPermission(perms, 'checkout', 'view');
}

export const savePaymentConfigAction = enhanceAction(
  async (data: unknown, user): Promise<ActionResult> => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    const auth = await assertCanManagePaymentSettings(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    const parsed = PaymentConfigSchema.parse(data);
    const service = new PaymentConfigService(auth.client);
    await service.updateConfig(parsed, user.id);

    revalidatePath('/home/settings/payments');

    return { success: true };
  },
  {},
);

export const testConnectionAction = enhanceAction(
  async (
    data: { provider: 'stripe' | 'square' },
    user,
  ): Promise<{ success: boolean; message: string }> => {
    const auth = await assertCanManagePaymentSettings(user.id);

    if (!auth.authorized) {
      return { success: false, message: UNAUTHORIZED_MESSAGE };
    }

    const service = new PaymentConfigService(auth.client);
    return service.testConnection(data.provider);
  },
  {},
);

export const createPaymentAction = enhanceAction(
  async (data: unknown, user) => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI (same rationale as the checks above). Unlike
    // those, this one throws rather than returning an ActionResult: the
    // caller (`checkout-form.tsx`) only branches on
    // `result.clientSecret`/`result.paymentId` and otherwise treats the
    // resolved value as a success (pushing to the checkout success page).
    // A returned `{ success: false }` shape has neither field, so it would
    // silently fall into that success branch. Throwing lets the existing
    // try/catch in `onSubmit` show `t('paymentError')` instead, matching
    // how validation errors from `CreatePaymentSchema.parse` below and
    // provider errors from `createPayment` are already handled.
    if (!(await assertCanCheckout(user.id))) {
      throw new Error('You do not have permission to make a payment.');
    }

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
