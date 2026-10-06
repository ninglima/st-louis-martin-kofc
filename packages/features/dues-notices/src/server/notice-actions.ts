'use server';

import { revalidatePath } from 'next/cache';

import * as z from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { readNoticesConfig } from '../config';
import type {
  ClaimedNotice,
  ManualSendResult,
  NoticeEvent,
  NoticeKind,
  NoticesActionResult,
} from '../types';
import { recordNoticesRun } from './job';
import { NoticesService } from './notices.service';
import { sendClaimedNotices } from './send-claimed';

/**
 * Expected failures are returned, never thrown: Next.js redacts thrown
 * Server Action messages in production. Same convention as hosting-actions.ts
 * and dues-actions.ts.
 */
function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to change dues notices.';
    case 'P0001':
      return e.message ?? 'The notice send was refused.';
    default:
      return 'Something went wrong saving the setting.';
  }
}

const OptOutSchema = z.object({
  memberId: z.string().uuid(),
  optOut: z.boolean(),
});

const KINDS = ['before_30', 'due_date', 'after_30'] as const;

const ManualSendSchema = z.object({
  kind: z.enum(KINDS),
  memberIds: z.array(z.string().uuid()).min(1).max(200),
});

export const setDuesNoticesOptOutAction = enhanceAction(
  async (data: unknown): Promise<NoticesActionResult> => {
    const parsed = OptOutSchema.safeParse(data);

    if (!parsed.success) {
      return { success: false, error: 'Invalid input' };
    }

    try {
      await new NoticesService(getSupabaseServerClient()).setOptOut(
        parsed.data.memberId,
        parsed.data.optOut,
      );

      revalidatePath('/home/members/[id]', 'page');
      revalidatePath('/home/dues-notices');

      return { success: true };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

type NoticeEventsResult =
  | { success: true; events: NoticeEvent[] }
  | { success: false; error: string };

export const loadNoticeEventsAction = enhanceAction(
  async (noticeId: unknown): Promise<NoticeEventsResult> => {
    const parsed = z.string().uuid().safeParse(noticeId);

    if (!parsed.success) {
      return { success: false, error: 'Invalid input' };
    }

    try {
      const events = await new NoticesService(getSupabaseServerClient()).events(
        parsed.data,
      );

      return { success: true, events };
    } catch {
      return { success: false, error: 'Could not load the events.' };
    }
  },
  {},
);

/**
 * finance.manage claims live notice rows for the selected members, then
 * sends through the same Resend path as the daily job (admin client for
 * status updates / run recording).
 */
export const sendManualNoticesAction = enhanceAction(
  async (data: unknown): Promise<ManualSendResult> => {
    const parsed = ManualSendSchema.safeParse(data);

    if (!parsed.success) {
      return { success: false, error: 'Invalid input' };
    }

    const config = readNoticesConfig();

    if (config.mode !== 'live') {
      return {
        success: false,
        error: 'Dues notices must be in live mode to send test emails.',
      };
    }

    if (config.missingForLive.length > 0) {
      return {
        success: false,
        error: `Live mode needs ${config.missingForLive.join(', ')}`,
      };
    }

    try {
      const userClient = getSupabaseServerClient();
      const { data: rows, error } = await userClient.rpc(
        'dues_notices_manual_claim',
        {
          p_kind: parsed.data.kind,
          p_member_ids: parsed.data.memberIds,
        },
      );

      if (error) {
        return { success: false, error: toMessage(error) };
      }

      const claimed: ClaimedNotice[] = (rows ?? []).map((r) => ({
        noticeId: r.notice_id,
        memberId: r.member_id,
        firstName: r.first_name,
        email: r.email,
        kind: r.kind as NoticeKind,
        cycleDate: r.cycle_date,
        firstDues: r.first_dues,
        levelName: r.level_name,
        amountCents: r.amount_cents,
      }));

      const admin = getSupabaseServerAdminClient();

      if (claimed.length === 0) {
        await recordNoticesRun(admin, {
          mode: 'live',
          candidates: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
          error: null,
        });
        revalidatePath('/home/dues-notices');
        return {
          success: true,
          candidates: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
        };
      }

      const sent = await sendClaimedNotices({
        client: admin,
        config,
        claimed,
      });

      await recordNoticesRun(admin, {
        mode: 'live',
        candidates: claimed.length,
        sent: sent.sent,
        skipped: sent.skipped,
        failed: sent.failed,
        error: sent.error,
      });

      revalidatePath('/home/dues-notices');

      return {
        success: true,
        candidates: claimed.length,
        sent: sent.sent,
        skipped: sent.skipped,
        failed: sent.failed,
      };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
