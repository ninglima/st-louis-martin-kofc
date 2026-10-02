'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  RetireDuesLevelSchema,
  SaveDuesLevelSchema,
  dollarsToCents,
} from '../schemas';
import { DuesService } from './dues.service';

/** Failures are returned, never thrown: Next redacts thrown action messages
 * in production (see `dues-actions.ts`). */
export type DuesLevelActionResult =
  | { success: true }
  | { success: false; error: string };

function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage dues levels.';
    // The functions raise plain, user-facing sentences (P0001).
    case 'P0001':
      return e.message ?? 'The dues level change was refused.';
    default:
      return 'Something went wrong saving the dues level.';
  }
}

async function run(
  fn: (service: DuesService) => Promise<unknown>,
): Promise<DuesLevelActionResult> {
  try {
    await fn(new DuesService(getSupabaseServerClient()));

    revalidatePath('/home/settings/dues-levels');
    revalidatePath('/home/checkout');
    revalidatePath('/home');

    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

function invalid(issues: { message: string }[]): DuesLevelActionResult {
  return { success: false, error: issues[0]?.message ?? 'Invalid input' };
}

export const saveDuesLevelAction = enhanceAction(async (data: unknown) => {
  const parsed = SaveDuesLevelSchema.safeParse(data);

  if (!parsed.success) {
    return invalid(parsed.error.issues);
  }

  const { slug, name, amount, selfService, sortOrder } = parsed.data;

  return run((service) =>
    service.saveLevel({
      slug,
      name,
      amountCents: dollarsToCents(amount),
      selfService,
      sortOrder: Number(sortOrder),
    }),
  );
}, {});

export const retireDuesLevelAction = enhanceAction(async (data: unknown) => {
  const parsed = RetireDuesLevelSchema.safeParse(data);

  if (!parsed.success) {
    return invalid(parsed.error.issues);
  }

  const { slug, moveTo } = parsed.data;

  return run((service) => service.retireLevel(slug, moveTo || null));
}, {});

export const restoreDuesLevelAction = enhanceAction(async (data: unknown) => {
  const slug = (data as { slug?: unknown } | null)?.slug;

  if (typeof slug !== 'string' || slug === '') {
    return invalid([{ message: 'Invalid input' }]);
  }

  return run((service) => service.restoreLevel(slug));
}, {});
