'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { hasPermission } from '@kit/rbac/types';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentConfigSchema } from '../schemas/payment-config.schema';
import { CreatePaymentSchema } from '../schemas/create-payment.schema';
import { ConfirmSquarePaymentSchema } from '../schemas/confirm-square-payment.schema';
import { PaymentConfigService } from './payment-config.service';
import { PaymentService } from './payment.service';
import { getPaymentProvider } from '../providers/provider-factory';
import type { PaymentStatus } from '../types/payment.types';

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

    const activeProvider = configResult.data?.active_provider ?? 'square';

    const paymentService = new PaymentService(adminClient);
    const payment = await paymentService.createPayment({
      ...parsed,
      userId: user.id,
      provider: activeProvider,
      providerPaymentId: result.paymentId,
    });

    // For Square there is no provider-side payment yet (see the comment on
    // `SquareProvider.createPayment`) -- `result.paymentId` is just a
    // locally-generated placeholder. The client instead needs the row's
    // real primary key so `confirmSquarePaymentAction` can look it up and
    // verify ownership once a card token exists. Stripe already returns a
    // real, provider-issued `paymentId` (the PaymentIntent id) that the
    // client uses together with `clientSecret`, so it is left untouched.
    if (activeProvider === 'square') {
      return { ...result, paymentId: payment.id };
    }

    return result;
  },
  {},
);

const CONFIRM_SQUARE_UNAUTHORIZED_MESSAGE =
  'You do not have permission to make a payment.';

export type ConfirmSquarePaymentResult =
  | { success: true; status: PaymentStatus }
  | { success: false; error: string };

/**
 * Completes the Square charge for a pending payment created by
 * `createPaymentAction`. The client tokenizes the card via the Square Web
 * Payments SDK (see `square-payment-form.tsx`) and sends the resulting
 * token here; this is the only place the actual Square `payments.create`
 * charge happens for Square. Errors are returned, not thrown, for the same
 * reason documented on `createPaymentAction` above and on `role-actions.ts`
 * -- except here the caller (`SquarePaymentForm.handleSubmit`) *does*
 * branch on `result.success` rather than treating any resolved value as a
 * success, so returning is safe and preferred (it also lets us surface a
 * specific, user-facing reason such as "already processed").
 */
export const confirmSquarePaymentAction = enhanceAction(
  async (data: unknown, user): Promise<ConfirmSquarePaymentResult> => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    if (!(await assertCanCheckout(user.id))) {
      return { success: false, error: CONFIRM_SQUARE_UNAUTHORIZED_MESSAGE };
    }

    const parsed = ConfirmSquarePaymentSchema.parse(data);
    const adminClient = getSupabaseServerAdminClient();

    const { data: payment, error: fetchError } = await adminClient
      .from('payments')
      .select('*')
      .eq('id', parsed.paymentId)
      .single();

    if (fetchError || !payment) {
      return { success: false, error: 'Payment not found.' };
    }

    // A caller must not be able to confirm -- and thus charge a card
    // against -- a payment row that belongs to someone else.
    if (payment.user_id !== user.id) {
      return {
        success: false,
        error: 'You do not have permission to confirm this payment.',
      };
    }

    // Guards against re-charging a payment that has already succeeded (or
    // otherwise left the pending state), whether from a duplicate submit,
    // a replayed request, or a race with the webhook handler.
    if (payment.status !== 'pending') {
      return {
        success: false,
        error: 'This payment has already been processed.',
      };
    }

    const provider = await getPaymentProvider(adminClient);

    if (!provider.chargeWithToken) {
      return {
        success: false,
        error: 'The active payment provider does not support this operation.',
      };
    }

    let result;

    try {
      result = await provider.chargeWithToken({
        sourceToken: parsed.sourceToken,
        amount: payment.amount,
        currency: payment.currency,
        note: payment.description ?? undefined,
      });
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to process payment.',
      };
    }

    const { error: updateError } = await adminClient
      .from('payments')
      .update({
        provider_payment_id: result.paymentId,
        status: result.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    if (updateError) {
      return {
        success: false,
        error:
          'Your card was charged, but we could not update the payment record. Please contact us.',
      };
    }

    if (result.status !== 'succeeded' && result.status !== 'processing') {
      return {
        success: false,
        error: 'The payment was not successful. Please try again.',
      };
    }

    return { success: true, status: result.status };
  },
  {},
);
