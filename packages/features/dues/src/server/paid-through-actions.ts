'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { enhanceAction } from '@kit/next/actions';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { CsvIssue, PaidThroughRow } from '../csv/paid-through-csv';
import { parsePaidThroughCsv } from '../csv/paid-through-csv';
import { PaidThroughRowsSchema, chicagoToday } from '../schemas';
import { DuesService } from './dues.service';

type Client = SupabaseClient<Database>;

/**
 * Next.js redacts thrown Server Action error messages in production builds,
 * so -- same as `dues-actions.ts` -- every expected failure is RETURNED.
 */
export type PreviewPaidThroughResult =
  | {
      success: true;
      rows: PaidThroughRow[];
      issues: CsvIssue[];
      unknownNumbers: string[];
      alreadyRecorded: string[];
    }
  | { success: false; error: string };

export type ApplyPaidThroughResult =
  | {
      success: true;
      applied: number;
      skipped: { membership_number: string; reason: string }[];
    }
  | { success: false; error: string };

/** Same mapping as `dues-actions.ts`'s `toMessage`: both files sit in front
 * of the same finance RPCs and their error codes, so the reasons an officer
 * reads are the same reasons whichever screen they came from. */
function toMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to manage dues.';
    case 'P0001':
      return e.message ?? 'The dues change was refused.';
    default:
      return 'Something went wrong loading the paid-through dates.';
  }
}

/**
 * Which of these membership numbers exist, keyed by number.
 *
 * Reads `members` directly rather than through `members_list`: that RPC
 * decrypts a page of ciphertext columns this screen never needs, and gates on
 * `members.view` -- the same permission `members_select_own` enforces for a
 * plain table read. Both this table read and `members_list` sit behind the
 * same gate, so this asks for nothing `members_list` would have refused; it
 * just does not pay for the decryption. Run as the signed-in officer (never
 * the admin client), so RLS sees the real caller.
 */
async function findMemberIds(
  client: Client,
  membershipNumbers: string[],
): Promise<Map<string, string>> {
  if (membershipNumbers.length === 0) {
    return new Map();
  }

  const { data, error } = await client
    .from('members')
    .select('id, membership_number')
    .in('membership_number', membershipNumbers);

  if (error) {
    throw error;
  }

  return new Map(data.map((row) => [row.membership_number, row.id]));
}

export const previewPaidThroughAction = enhanceAction(
  async (data: unknown): Promise<PreviewPaidThroughResult> => {
    if (typeof data !== 'string' || data.trim() === '') {
      return { success: false, error: 'Choose a CSV file to upload.' };
    }

    const { rows, issues } = parsePaidThroughCsv(data, chicagoToday());

    try {
      const client = getSupabaseServerClient();

      const membershipNumbers = [
        ...new Set(rows.map((r) => r.membershipNumber)),
      ];
      const memberIds = await findMemberIds(client, membershipNumbers);

      const unknownNumbers = membershipNumbers.filter(
        (number) => !memberIds.has(number),
      );

      const summaries = await new DuesService(client).summaries([
        ...memberIds.values(),
      ]);

      const alreadyRecorded = membershipNumbers.filter((number) => {
        const memberId = memberIds.get(number);

        return (
          memberId !== undefined && summaries.get(memberId)?.paidThrough != null
        );
      });

      return { success: true, rows, issues, unknownNumbers, alreadyRecorded };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const applyPaidThroughAction = enhanceAction(
  async (data: unknown): Promise<ApplyPaidThroughResult> => {
    const parsed = PaidThroughRowsSchema.safeParse(data);

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid input',
      };
    }

    try {
      const service = new DuesService(getSupabaseServerClient());

      const result = await service.applyOpeningBalances(
        parsed.data.map((row) => ({
          membership_number: row.membershipNumber,
          paid_through: row.paidThrough,
          ...(row.duesLevel !== undefined ? { dues_level: row.duesLevel } : {}),
        })),
      );

      revalidatePath('/home/members');
      revalidatePath('/home/members/[id]', 'page');

      return {
        success: true,
        applied: result.applied,
        skipped: result.skipped,
      };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);
