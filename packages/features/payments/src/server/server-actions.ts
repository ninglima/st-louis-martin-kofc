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
import {
  describeSquareChargeError,
  isDefiniteSquareChargeFailure,
} from '../providers/square.provider';
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
    // caller (`checkout-form.tsx`) only ever uses the resolved value to
    // populate `paymentIntent` (`clientSecret`/`paymentId`) and render the
    // matching provider's payment form -- it never branches on a
    // `success` flag. A returned `{ success: false }` shape has neither
    // field, so `paymentIntent` would be set from `undefined`s and
    // `StripePaymentForm`/`SquarePaymentForm` would mount and fail
    // obscurely instead of showing a clear error. Throwing lets the
    // existing try/catch in `onSubmit` show `t('paymentError')` instead,
    // matching how validation errors from `CreatePaymentSchema.parse`
    // below and provider errors from `createPayment` are already handled.
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

    const provider = await getPaymentProvider(adminClient);

    if (!provider.chargeWithToken) {
      return {
        success: false,
        error: 'The active payment provider does not support this operation.',
      };
    }

    // Atomically claim the row before charging. A plain read-then-check
    // (fetch, check `status === 'pending'`, charge, update) has a network
    // round-trip between the check and the charge, so two concurrent
    // confirms of the same payment (two tabs, a replayed direct POST) can
    // both pass the check and both charge the card. Conditioning this
    // UPDATE on `status = 'pending'` makes the claim itself the guard --
    // only one concurrent request can ever move the row out of `pending`,
    // so only one can reach the charge below. If zero rows come back,
    // someone else already claimed it (or it was never pending).
    const { data: claimedRows, error: claimError } = await adminClient
      .from('payments')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', payment.id)
      .eq('status', 'pending')
      .select();

    if (claimError) {
      return {
        success: false,
        error: 'Failed to process payment. Please try again.',
      };
    }

    if (!claimedRows || claimedRows.length === 0) {
      return {
        success: false,
        error: 'This payment has already been processed.',
      };
    }

    let result;

    try {
      result = await provider.chargeWithToken({
        sourceToken: parsed.sourceToken,
        amount: payment.amount,
        currency: payment.currency,
        note: payment.description ?? undefined,
        // Stable and derived from the row rather than freshly minted per
        // call, so a retry of this same payment reuses the same key and
        // Square dedupes it instead of charging the card twice. See the
        // doc comment on `ChargeWithTokenParams.idempotencyKey`.
        idempotencyKey: payment.id,
        // Links the Square-side payment back to this row for dashboard
        // reconciliation (the old `createPayment` set this to the user id;
        // the row id is the more useful key since it's unique per charge).
        referenceId: payment.id,
      });
    } catch (error) {
      // A charge failure must not strand the row in `processing` forever.
      // Which state it lands in next depends on what Square told us:
      //  - A *definite* failure (a 4xx `SquareError` -- a decline or
      //    validation error) means Square rejected the request and
      //    nothing was charged. The row goes to `failed`, a terminal
      //    state; `SquarePaymentForm` offers a link back to
      //    `/home/checkout` to start a fresh payment (see 1g in the
      //    review) rather than retrying this row, since a new sourceToken
      //    against the same idempotency key that Square already has on
      //    file for a failed attempt is not something we can rely on.
      //  - An *ambiguous* failure (a timeout, a dropped connection, a 5xx
      //    from Square's own infra) means we don't know whether the
      //    charge was actually created. The row goes back to `pending` so
      //    the member can tap "Pay Now" again on the same still-mounted
      //    form -- that retry reuses this same `payment.id` idempotency
      //    key, so if the original charge *did* go through despite the
      //    error surfacing here, Square dedupes the retry instead of
      //    charging again. This is the fix for the double-charge scenario
      //    this review flagged (1a).
      const nextStatus = isDefiniteSquareChargeFailure(error)
        ? 'failed'
        : 'pending';

      await adminClient
        .from('payments')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', payment.id);

      return {
        success: false,
        error:
          describeSquareChargeError(error) ??
          'Payment failed. Please try again.',
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
      // The charge succeeded on Square's side but we failed to record it.
      // `provider_payment_id` is still the placeholder `createPayment` set
      // (see `SquareProvider.createPayment`), so the webhook handler --
      // which looks payments up by `provider_payment_id` -- cannot repair
      // this either. This log is the only remaining record that money was
      // taken; it has to be reconciled by hand against Square's dashboard.
      // No card data or tokens, only the ids needed to look the charge up.
      console.error('Square charge succeeded but payment record update failed.', {
        paymentId: payment.id,
        squarePaymentId: result.paymentId,
        error: updateError.message,
      });

      return {
        success: false,
        error:
          'Your card was charged, but we could not update the payment record. Please contact us.',
      };
    }

    if (result.status !== 'succeeded' && result.status !== 'processing') {
      // Square returned a 200 but the payment itself is in a terminal,
      // non-success state (e.g. a hard decline reported as
      // `payment.status = FAILED` rather than as an HTTP error). Nothing
      // was charged, and the row above is now written to that terminal
      // status (not `pending`), so a plain retry of this row is
      // intentionally a dead end -- `SquarePaymentForm` links back to
      // `/home/checkout` for a fresh attempt instead (see 1g).
      return {
        success: false,
        error: 'The payment was not successful.',
      };
    }

    return { success: true, status: result.status };
  },
  {},
);
