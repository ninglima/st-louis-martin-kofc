import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isEmailAllowlisted,
  NOT_ON_ALLOWLIST_ERROR,
} from '@kit/email/allowlist';
import { isPlausibleEmail } from '@kit/email/email-format';
import { sendEmail } from '@kit/email/resend';
import type { Database } from '@kit/supabase/database';

import {
  readPaymentReceiptsConfig,
  type PaymentReceiptsConfig,
} from '../config';
import { renderReceipt } from '../templates/receipt';
import type { PaymentType } from '../types/payment.types';

type Client = SupabaseClient<Database>;

export const NO_EMAIL_ERROR = 'no email address';
export const INVALID_EMAIL_ERROR = 'invalid email address';

type PaymentRow = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  payment_type: PaymentType;
  description: string | null;
  provider: string;
  provider_payment_id: string | null;
  status: string;
  receipt_sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Sends a branded receipt once when a payment first reaches `succeeded`.
 * Safe to call from webhooks and Square confirm: claims `receipt_sent_at`
 * before calling Resend, and never throws (payment status must stay correct
 * even if email fails).
 */
export async function sendPaymentReceiptOnce(
  client: Client,
  paymentId: string,
  {
    config = readPaymentReceiptsConfig(),
    fetchImpl = fetch,
    now = () => new Date().toISOString(),
  }: {
    config?: PaymentReceiptsConfig;
    fetchImpl?: typeof fetch;
    now?: () => string;
  } = {},
): Promise<void> {
  try {
    await sendPaymentReceiptOnceInner(client, paymentId, {
      config,
      fetchImpl,
      now,
    });
  } catch (error) {
    console.error('Payment receipt send failed unexpectedly.', {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sendPaymentReceiptOnceInner(
  client: Client,
  paymentId: string,
  {
    config,
    fetchImpl,
    now,
  }: {
    config: PaymentReceiptsConfig;
    fetchImpl: typeof fetch;
    now: () => string;
  },
): Promise<void> {
  if (config.mode === 'off') return;

  if (config.mode === 'live' && config.missingForLive.length > 0) {
    console.warn('Payment receipt skipped: live mode needs config.', {
      paymentId,
      missing: config.missingForLive,
    });
    return;
  }

  const { data: payment, error: loadError } = await client
    .from('payments')
    .select(
      'id, user_id, amount, currency, payment_type, description, provider, provider_payment_id, status, receipt_sent_at, created_at, updated_at',
    )
    .eq('id', paymentId)
    .maybeSingle();

  if (loadError) {
    console.error('Payment receipt could not load payment.', {
      paymentId,
      error: loadError.message,
    });
    return;
  }

  if (!payment) return;

  const row = payment as PaymentRow;

  if (row.status !== 'succeeded') return;
  if (row.receipt_sent_at) return;

  const recipient = await resolveRecipient(client, row.user_id);

  if (!recipient.email) {
    await claimAndRecordError(client, paymentId, now(), NO_EMAIL_ERROR);
    return;
  }

  if (!isPlausibleEmail(recipient.email)) {
    await claimAndRecordError(client, paymentId, now(), INVALID_EMAIL_ERROR);
    return;
  }

  if (!isEmailAllowlisted(recipient.email, config.allowlist)) {
    await claimAndRecordError(client, paymentId, now(), NOT_ON_ALLOWLIST_ERROR);
    return;
  }

  const claimedAt = now();
  const { data: claimed, error: claimError } = await client
    .from('payments')
    .update({
      receipt_sent_at: claimedAt,
      receipt_error: null,
    })
    .eq('id', paymentId)
    .is('receipt_sent_at', null)
    .select('id');

  if (claimError) {
    console.error('Payment receipt claim failed.', {
      paymentId,
      error: claimError.message,
    });
    return;
  }

  if (!claimed || claimed.length === 0) return;

  if (config.mode === 'dry_run') return;

  const rendered = renderReceipt({
    firstName: recipient.firstName,
    amountCents: row.amount,
    paymentType: row.payment_type,
    description: row.description,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    paidAt: row.updated_at ?? row.created_at ?? claimedAt,
    siteUrl: config.siteUrl,
  });

  const outcome = await sendEmail(
    config.apiKey,
    {
      from: config.from,
      to: recipient.email,
      replyTo: config.replyTo || undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [
        { name: 'payment_id', value: paymentId },
        { name: 'payment_type', value: row.payment_type },
      ],
    },
    {
      idempotencyKey: `payment-receipt/${paymentId}`,
      fetchImpl,
    },
  );

  if (outcome.ok) {
    const { error } = await client
      .from('payments')
      .update({ receipt_error: null })
      .eq('id', paymentId);

    if (error) {
      console.error('Payment receipt cleared error but write failed.', {
        paymentId,
        error: error.message,
      });
    }
    return;
  }

  if (outcome.retryable) {
    const { error } = await client
      .from('payments')
      .update({
        receipt_sent_at: null,
        receipt_error: outcome.error,
      })
      .eq('id', paymentId);

    if (error) {
      console.error('Payment receipt could not clear claim after retryable failure.', {
        paymentId,
        error: error.message,
      });
    }
    return;
  }

  const { error } = await client
    .from('payments')
    .update({ receipt_error: outcome.error })
    .eq('id', paymentId);

  if (error) {
    console.error('Payment receipt permanent failure could not be recorded.', {
      paymentId,
      error: error.message,
    });
  }
}

async function resolveRecipient(
  client: Client,
  userId: string,
): Promise<{ email: string | null; firstName: string | null }> {
  const [member, account] = await Promise.all([
    client
      .from('members')
      .select('primary_email, first_name')
      .eq('user_id', userId)
      .maybeSingle(),
    client.from('accounts').select('email, name').eq('id', userId).maybeSingle(),
  ]);

  const memberEmail = member.data?.primary_email?.trim() || null;
  const accountEmail = account.data?.email?.trim() || null;
  const email = memberEmail || accountEmail;
  const firstName =
    member.data?.first_name?.trim() ||
    account.data?.name?.trim()?.split(/\s+/)[0] ||
    null;

  return { email, firstName };
}

async function claimAndRecordError(
  client: Client,
  paymentId: string,
  claimedAt: string,
  error: string,
): Promise<void> {
  const { error: updateError } = await client
    .from('payments')
    .update({
      receipt_sent_at: claimedAt,
      receipt_error: error,
    })
    .eq('id', paymentId)
    .is('receipt_sent_at', null);

  if (updateError) {
    console.error('Payment receipt skip could not be recorded.', {
      paymentId,
      error: updateError.message,
      reason: error,
    });
  }
}
