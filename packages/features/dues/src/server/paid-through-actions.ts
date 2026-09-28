'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { CsvIssue, PaidThroughRow } from '../csv/paid-through-csv';
import { parsePaidThroughCsv } from '../csv/paid-through-csv';
import {
  PaidThroughCsvTextSchema,
  PaidThroughRowsSchema,
  chicagoToday,
} from '../schemas';
import { DuesService } from './dues.service';

type Client = SupabaseClient<Database>;

/** Members lookups are chunked (I3): `.in('membership_number', [...])`
 * serialises every value into the PostgREST request, and a multi-thousand
 * row CSV would otherwise build a single query long enough to trip a
 * gateway URL limit. 200 keeps each request comfortably small without
 * turning a 5,000-row load into a very long, very serial wait. */
const LOOKUP_CHUNK_SIZE = 200;

/** Matches `PaidThroughRowsSchema`'s cap (I3): the preview refuses a file
 * this big before it does any lookup work, rather than discovering the
 * limit only once `applyPaidThroughAction` re-validates. */
const MAX_ROWS = 5000;

const UNAUTHORIZED_MESSAGE = 'You do not have permission to manage dues.';

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
      unknownLevels: { membershipNumber: string; level: string }[];
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
      return UNAUTHORIZED_MESSAGE;
    case 'P0001':
      return e.message ?? 'The dues change was refused.';
    default:
      return 'Something went wrong loading the paid-through dates.';
  }
}

/**
 * Both actions require the same two grants: `finance.manage` to load an
 * opening balance at all, and `members.view` because the preview reads the
 * `members` table by membership number under RLS (`members_select_own`) to
 * find out which numbers exist -- `dues_opening_balances_apply` itself is
 * `security definer` and only checks `finance.manage`, but a caller who
 * cannot see the roster would get a preview where every number reads
 * "unknown", which is misleading rather than merely restrictive. R15 makes
 * this a page-level requirement (`dues-import/page.tsx`); it is repeated
 * here because a Server Action is reachable directly, without ever loading
 * that page.
 *
 * `role_permissions`/`user_roles` sit behind `roles.manage`-gated RLS (see
 * `roster-actions.ts`'s `requireManage`), so a caller cannot read their own
 * grants under RLS -- this loads them with the admin client, same shape as
 * `apps/portal/lib/server/require-permission.ts` and `roster-actions.ts`.
 */
async function canManagePaidThrough(userId: string): Promise<boolean> {
  const perms = await loadPermissionsForUser(
    getSupabaseServerAdminClient(),
    userId,
  );

  return (
    hasPermission(perms, 'finance', 'manage') &&
    hasPermission(perms, 'members', 'view')
  );
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
 *
 * Chunked in batches of `LOOKUP_CHUNK_SIZE` (I3): several small `.in()`
 * queries rather than one holding every membership number in the file, so a
 * multi-thousand-row CSV cannot build a request long enough to trip a
 * gateway URL limit.
 */
async function findMemberIds(
  client: Client,
  membershipNumbers: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  for (let i = 0; i < membershipNumbers.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = membershipNumbers.slice(i, i + LOOKUP_CHUNK_SIZE);

    if (chunk.length === 0) continue;

    const { data, error } = await client
      .from('members')
      .select('id, membership_number')
      .in('membership_number', chunk);

    if (error) {
      throw error;
    }

    for (const row of data) {
      found.set(row.membership_number, row.id);
    }
  }

  return found;
}

export const previewPaidThroughAction = enhanceAction(
  async (data: unknown, user): Promise<PreviewPaidThroughResult> => {
    if (!(await canManagePaidThrough(user.id))) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    const parsedText = PaidThroughCsvTextSchema.safeParse(data);

    if (!parsedText.success) {
      return {
        success: false,
        error: parsedText.error.issues[0]?.message ?? 'Invalid input',
      };
    }

    const { rows, issues } = parsePaidThroughCsv(
      parsedText.data,
      chicagoToday(),
    );

    if (rows.length > MAX_ROWS) {
      return {
        success: false,
        error: `That file has more than ${MAX_ROWS.toLocaleString()} rows.`,
      };
    }

    try {
      const client = getSupabaseServerClient();

      const membershipNumbers = [
        ...new Set(rows.map((r) => r.membershipNumber)),
      ];
      const [memberIds, activeLevels] = await Promise.all([
        findMemberIds(client, membershipNumbers),
        new DuesService(client).levels(),
      ]);

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

      // I4: readable by any authenticated user (`dues_levels_select`), so
      // this costs no extra permission -- a row naming a level that is not
      // active (misspelled, retired) would otherwise pass the preview clean
      // and only fail at apply with 'unknown dues level'.
      const activeSlugs = new Set(activeLevels.map((level) => level.slug));

      const unknownLevels = rows
        .filter(
          (row) =>
            row.duesLevel !== undefined && !activeSlugs.has(row.duesLevel),
        )
        .map((row) => ({
          membershipNumber: row.membershipNumber,
          level: row.duesLevel as string,
        }));

      return {
        success: true,
        rows,
        issues,
        unknownNumbers,
        alreadyRecorded,
        unknownLevels,
      };
    } catch (error) {
      return { success: false, error: toMessage(error) };
    }
  },
  {},
);

export const applyPaidThroughAction = enhanceAction(
  async (data: unknown, user): Promise<ApplyPaidThroughResult> => {
    if (!(await canManagePaidThrough(user.id))) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

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
