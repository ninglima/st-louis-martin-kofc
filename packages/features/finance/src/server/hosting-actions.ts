'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  DeleteHostingCostSchema,
  HostingCostFormSchema,
  OverlapCheckSchema,
  RepeatLastBillSchema,
  toHostingCostInput,
} from '../schemas';
import type { FinanceActionResult } from '../types';
import { FinanceService } from './finance.service';

/** Expected failures are returned, never thrown: Next.js redacts thrown
 * Server Action messages in production. Same convention as dues-actions.ts. */
function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage hosting costs.';
    case 'P0001':
      return e.message ?? 'The hosting cost was refused.';
    default:
      return 'Something went wrong saving the hosting cost.';
  }
}

function invalid(issues: { message: string }[]): FinanceActionResult {
  return {
    success: false,
    error: issues[0]?.message ?? 'Check the bill details.',
  };
}

async function run(
  fn: (service: FinanceService) => Promise<void>,
): Promise<FinanceActionResult> {
  try {
    await fn(new FinanceService(getSupabaseServerClient()));

    revalidatePath('/home/hosting-costs');
    revalidatePath('/home');

    return { success: true };
  } catch (error) {
    return { success: false, error: toMessage(error) };
  }
}

export const saveHostingCostAction = enhanceAction(async (data: unknown) => {
  const parsed = HostingCostFormSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error.issues);

  return run((service) => service.saveCost(toHostingCostInput(parsed.data)));
}, {});

export const deleteHostingCostAction = enhanceAction(async (data: unknown) => {
  const parsed = DeleteHostingCostSchema.safeParse(data);
  if (!parsed.success) return invalid(parsed.error.issues);

  return run((service) => service.deleteCost(parsed.data.id));
}, {});

export const repeatLastHostingCostAction = enhanceAction(
  async (data: unknown) => {
    const parsed = RepeatLastBillSchema.safeParse(data);
    if (!parsed.success) return invalid(parsed.error.issues);

    return run((service) => service.repeatLast(parsed.data.provider));
  },
  {},
);

export const hostingOverlapsAction = enhanceAction(
  async (
    data: unknown,
  ): Promise<
    { success: true; overlaps: string[] } | { success: false; error: string }
  > => {
    const parsed = OverlapCheckSchema.safeParse(data);
    if (!parsed.success)
      return { success: false, error: 'Check the covered dates.' };

    try {
      const overlaps = await new FinanceService(
        getSupabaseServerClient(),
      ).overlaps(parsed.data);
      return { success: true, overlaps };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
