'use server';

import { revalidatePath } from 'next/cache';

import * as z from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { NoticeEvent, NoticesActionResult } from '../types';
import { NoticesService } from './notices.service';

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
    default:
      return 'Something went wrong saving the setting.';
  }
}

const OptOutSchema = z.object({
  memberId: z.string().uuid(),
  optOut: z.boolean(),
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
