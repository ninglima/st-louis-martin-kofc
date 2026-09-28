'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AcceptedOnSchema,
  LevelSchema,
  RecordPaymentSchema,
  StudentSchema,
  VoidPeriodSchema,
} from '../schemas';
import { DuesService } from './dues.service';

/**
 * Next.js redacts thrown Server Action error messages in production builds,
 * so -- as everywhere else in this app (`role-actions.ts`,
 * `server-actions.ts` in `@kit/payments`) -- expected failures are RETURNED,
 * never thrown.
 */
export type DuesActionResult =
  | { success: true }
  | { success: false; error: string };

function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage dues.';
    case '23P01':
      return 'That would overlap an existing dues period.';
    case '23514':
      return 'A check number is required.';
    case 'P0001':
      return e.message ?? 'The dues change was refused.';
    default:
      return 'Something went wrong saving the dues change.';
  }
}

async function run(
  fn: (service: DuesService) => Promise<void>,
): Promise<DuesActionResult> {
  try {
    await fn(new DuesService(getSupabaseServerClient()));

    revalidatePath('/home/members');
    revalidatePath('/home/members/[id]', 'page');

    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const recordDuesPaymentAction = enhanceAction(async (data: unknown) => {
  const parsed = RecordPaymentSchema.safeParse(data);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    } as DuesActionResult;
  }

  return run((service) => service.recordPayment(parsed.data));
}, {});

export const voidDuesPeriodAction = enhanceAction(async (data: unknown) => {
  const parsed = VoidPeriodSchema.safeParse(data);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    } as DuesActionResult;
  }

  return run((service) =>
    service.voidPeriod(parsed.data.periodId, parsed.data.reason),
  );
}, {});

export const setAcceptedOnAction = enhanceAction(async (data: unknown) => {
  const parsed = AcceptedOnSchema.safeParse(data);

  if (!parsed.success) {
    return { success: false, error: 'Enter a valid date' } as DuesActionResult;
  }

  return run((service) =>
    service.setAcceptedOn(parsed.data.memberId, parsed.data.acceptedOn),
  );
}, {});

export const setDuesLevelAction = enhanceAction(async (data: unknown) => {
  const parsed = LevelSchema.safeParse(data);

  if (!parsed.success) {
    return { success: false, error: 'Choose a dues level' } as DuesActionResult;
  }

  return run((service) =>
    service.setLevel(parsed.data.memberId, parsed.data.level),
  );
}, {});

export const setStudentAction = enhanceAction(async (data: unknown) => {
  const parsed = StudentSchema.safeParse(data);

  if (!parsed.success) {
    return { success: false, error: 'Invalid input' } as DuesActionResult;
  }

  return run((service) =>
    service.setStudent(parsed.data.memberId, parsed.data.isStudent),
  );
}, {});
