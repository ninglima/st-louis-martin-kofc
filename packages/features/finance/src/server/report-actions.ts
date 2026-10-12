'use server';

import { revalidatePath } from 'next/cache';

import type { JwtPayload } from '@supabase/supabase-js';
import * as z from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { PaymentPacketFormSchema, toPaymentPacketCents } from '../schemas';
import type { FinanceActionResult } from '../types';
import { FinanceService } from './finance.service';
import {
  type ReportMailConfig,
  readReportMailConfig,
  renderPacketReport,
  renderWorksheetReport,
  reportEmailBlocker,
  sendFinanceReport,
} from './report-mail';

/** Expected failures are returned, never thrown: Next.js redacts thrown
 * Server Action messages in production. Same convention as hosting-actions.ts. */
function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to use reports.';
    case 'P0001':
      return e.message ?? 'The report was refused.';
    default:
      return 'Something went wrong with the report.';
  }
}

function invalid(issues: { message: string }[]): {
  success: false;
  error: string;
} {
  return {
    success: false,
    error: issues[0]?.message ?? 'Check the packet details.',
  };
}

function inputOf(data: unknown): unknown {
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    return Object.fromEntries(data.entries());
  }

  return data;
}

const EmailWorksheetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
});

const EmailPacketSchema = z.object({
  id: z.string().uuid(),
});

const DeletePaymentPacketSchema = z.object({ id: z.string().uuid() });

type MailResult =
  | { success: true; sentTo: string }
  | { success: false; error: string };

const PERMISSION_ERROR = 'You do not have permission to use reports.';

async function authorizeReport(
  user: JwtPayload,
): Promise<
  | { ok: true; recipient: string; config: ReportMailConfig }
  | { ok: false; error: string }
> {
  if (!user.sub) return { ok: false, error: PERMISSION_ERROR };

  const perms = await loadPermissionsForUser(
    getSupabaseServerAdminClient(),
    user.sub,
  );

  if (!hasPermission(perms, 'dashboard_finance', 'view')) {
    return { ok: false, error: PERMISSION_ERROR };
  }

  const recipient = user.email ?? null;
  const config = readReportMailConfig();
  const blocker = reportEmailBlocker(config, recipient);

  if (blocker) return { ok: false, error: blocker };
  if (!recipient?.trim()) {
    return {
      ok: false,
      error: 'The signed-in account has no email address',
    };
  }

  return { ok: true, recipient: recipient.trim(), config };
}

/** Sends the already-rendered report. A failure returns the Resend error
 * and does not delete the packet: this function never writes. */
async function deliver(
  auth: { recipient: string; config: ReportMailConfig },
  rendered: { subject: string; html: string; text: string },
): Promise<MailResult> {
  const sent = await sendFinanceReport({
    config: auth.config,
    recipient: auth.recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!sent.ok) return { success: false, error: sent.error };

  return { success: true, sentTo: auth.recipient };
}

export const savePaymentPacketAction = enhanceAction(
  async (data: unknown): Promise<FinanceActionResult> => {
    const parsed = PaymentPacketFormSchema.safeParse(inputOf(data));
    if (!parsed.success) return invalid(parsed.error.issues);

    const cents = toPaymentPacketCents(parsed.data);
    const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;

    try {
      await new FinanceService(getSupabaseServerClient()).savePaymentPacket({
        id: parsed.data.id,
        label: parsed.data.label,
        supremeCents: cents.supremeCents,
        stateCents: cents.stateCents,
        note,
      });

      revalidatePath('/home/reports');

      return { success: true };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const deletePaymentPacketAction = enhanceAction(
  async (data: unknown): Promise<FinanceActionResult> => {
    const parsed = DeletePaymentPacketSchema.safeParse(inputOf(data));
    if (!parsed.success) return invalid(parsed.error.issues);

    try {
      await new FinanceService(getSupabaseServerClient()).deletePaymentPacket(
        parsed.data.id,
      );

      revalidatePath('/home/reports');

      return { success: true };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const emailWorksheetAction = enhanceAction(
  async (data: unknown, user): Promise<MailResult> => {
    const parsed = EmailWorksheetSchema.safeParse(inputOf(data));
    if (!parsed.success) return invalid(parsed.error.issues);

    const auth = await authorizeReport(user);
    if (!auth.ok) return { success: false, error: auth.error };

    try {
      const worksheet = await new FinanceService(
        getSupabaseServerClient(),
      ).monthlyWorksheet(parsed.data.month);

      return deliver(
        auth,
        renderWorksheetReport(worksheet, auth.config.siteUrl),
      );
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const emailPacketAction = enhanceAction(
  async (data: unknown, user): Promise<MailResult> => {
    const parsed = EmailPacketSchema.safeParse(inputOf(data));
    if (!parsed.success) return invalid(parsed.error.issues);

    const auth = await authorizeReport(user);
    if (!auth.ok) return { success: false, error: auth.error };

    try {
      const packets = await new FinanceService(
        getSupabaseServerClient(),
      ).paymentPackets();
      const packet = packets.find((row) => row.id === parsed.data.id);

      if (!packet) {
        return { success: false, error: 'payment packet not found' };
      }

      return deliver(auth, renderPacketReport(packet, auth.config.siteUrl));
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
