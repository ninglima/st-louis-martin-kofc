'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import * as z from 'zod';

import { readEventEmailsConfig } from '@kit/event-emails/config';
import { dispatchEventEmails } from '@kit/event-emails/server/dispatch';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { toMessage } from '../lib/errors';
import {
  EventFormSchema,
  EventTypeSchema,
  toCreatePayload,
  toShiftsPayload,
  toUpdateFields,
} from '../schemas';
import type { EventsActionResult, MemberOption, SeriesPreview } from '../types';
import { EventsService } from './events.service';

const Id = z.string().guid();
const Scope = z.enum(['this', 'following']);

function service() {
  return new EventsService(getSupabaseServerClient());
}

function invalid(issues: { message: string }[]): EventsActionResult<never> {
  return { success: false, error: issues[0]?.message ?? 'Check the details.' };
}

/**
 * Sends the emails the change just queued, after the response. Nothing here
 * may reach the action: building the config or client can throw, and so can
 * the dispatch itself.
 */
function sendQueuedEmails() {
  try {
    after(async () => {
      try {
        await dispatchEventEmails({
          client: getSupabaseServerAdminClient(),
          config: readEventEmailsConfig(),
        });
      } catch (error) {
        console.error('event email dispatch failed', error);
      }
    });
  } catch (error) {
    console.error('event email dispatch failed', error);
  }
}

async function attempt<T>(
  fn: () => Promise<T>,
  { sendEmails = false }: { sendEmails?: boolean } = {},
): Promise<EventsActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath('/home/events', 'layout');
    revalidatePath('/home/volunteering');
    if (sendEmails) sendQueuedEmails();

    return { success: true, data };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const saveEventTypeAction = enhanceAction(async (input: unknown) => {
  const parsed = EventTypeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  return attempt(() => service().saveType(parsed.data));
}, {});

export const createEventAction = enhanceAction(async (input: unknown) => {
  const parsed = EventFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  return attempt(() => service().create(toCreatePayload(parsed.data)));
}, {});

export const updateEventAction = enhanceAction(
  async (input: {
    eventId: string;
    scope: 'this' | 'following';
    values: unknown;
  }) => {
    const parsed = EventFormSchema.safeParse(input.values);
    if (!parsed.success) return invalid(parsed.error.issues);
    if (
      !Id.safeParse(input.eventId).success ||
      !Scope.safeParse(input.scope).success
    ) {
      return { success: false, error: 'That event no longer exists.' } as const;
    }

    return attempt(
      async () => {
        const s = service();
        await s.update(
          input.eventId,
          toUpdateFields(parsed.data, input.scope),
          input.scope,
        );
        // Shifts belong to this event only, whatever the scope.
        await s.saveShifts(input.eventId, toShiftsPayload(parsed.data.shifts));
      },
      { sendEmails: true },
    );
  },
  {},
);

export const cancelEventAction = enhanceAction(
  async (input: { eventId: string; scope: 'this' | 'following' }) => {
    if (
      !Id.safeParse(input.eventId).success ||
      !Scope.safeParse(input.scope).success
    ) {
      return { success: false, error: 'That event no longer exists.' } as const;
    }

    return attempt(
      () =>
        service().update(input.eventId, { status: 'cancelled' }, input.scope),
      { sendEmails: true },
    );
  },
  {},
);

export const previewSeriesAction = enhanceAction(
  async (
    rule: Record<string, unknown>,
  ): Promise<EventsActionResult<SeriesPreview>> => {
    try {
      return { success: true, data: await service().preview(rule) };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const signupAction = enhanceAction(
  async (input: { shiftId: string }) => {
    if (!Id.safeParse(input.shiftId).success)
      return { success: false, error: 'That shift no longer exists.' } as const;

    return attempt(() => service().signup(input.shiftId), {
      sendEmails: true,
    });
  },
  {},
);

export const cancelSignupAction = enhanceAction(
  async (input: { signupId: string }) => {
    if (!Id.safeParse(input.signupId).success)
      return {
        success: false,
        error: 'That sign-up no longer exists.',
      } as const;

    return attempt(() => service().cancelSignup(input.signupId));
  },
  {},
);

export const addVolunteerAction = enhanceAction(
  async (input: { shiftId: string; memberId: string }) => {
    if (
      !Id.safeParse(input.shiftId).success ||
      !Id.safeParse(input.memberId).success
    ) {
      return { success: false, error: 'Choose a member.' } as const;
    }

    return attempt(() => service().addVolunteer(input.shiftId, input.memberId));
  },
  {},
);

export const setAttendanceAction = enhanceAction(
  async (input: {
    signupId: string;
    status: 'attended' | 'no_show';
    hours: number | null;
  }) => {
    if (!Id.safeParse(input.signupId).success)
      return {
        success: false,
        error: 'That sign-up no longer exists.',
      } as const;
    if (input.status !== 'attended' && input.status !== 'no_show')
      return { success: false, error: 'Choose attended or no-show.' } as const;

    return attempt(() =>
      service().setAttendance(input.signupId, input.status, input.hours),
    );
  },
  {},
);

export const searchMembersAction = enhanceAction(
  async (input: {
    eventId: string | null;
    query: string;
  }): Promise<EventsActionResult<MemberOption[]>> => {
    try {
      return {
        success: true,
        data: await service().searchMembers(
          input.eventId,
          String(input.query ?? ''),
        ),
      };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const setEventRemindersAction = enhanceAction(
  async (input: { enabled: boolean }) => {
    if (typeof input.enabled !== 'boolean')
      return { success: false, error: 'Choose on or off.' } as const;

    return attempt(() => service().setMyEventReminders(!input.enabled));
  },
  {},
);
