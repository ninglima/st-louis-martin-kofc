'use server';

import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { MembersService } from './members.service';
import type { MemberListRow } from './members.service';

/**
 * Next.js redacts thrown Server Action messages in production, so — as
 * everywhere else in this feature — the expected failures are RETURNED.
 */
export type ExportResult =
  | { success: true; filename: string; csv: string; truncated: boolean }
  | { success: false; error: string };

/**
 * `members_list` caps `p_limit` at 200 (`least(greatest(p_limit, 0), 200)` in
 * 20260922221437_members_fixes.sql), so an export of a 372-member council is
 * necessarily several calls. Asking for the ceiling is right here and wrong on
 * the screen: the list renders one page of 50 because nobody reads 372 rows at
 * once, whereas a spreadsheet is by definition the whole filtered set.
 */
const PAGE = 200;

/**
 * A hard stop, so a filter that matches everything cannot turn one click into
 * an unbounded decrypt loop. It is ~13x the council's real size; reaching it
 * means something is wrong, and the officer is told rather than handed a file
 * that quietly stops early.
 */
const MAX_ROWS = 5_000;

const UNAUTHORIZED_MESSAGE = 'You do not have permission to view the roster.';

const HEADER = [
  'Membership Number',
  'Name',
  'Email',
  'Phone',
  'Address',
  'City',
  'State',
  'Postal Code',
  'Bad Address',
  'Has Account',
  'Roster Last Seen',
];

/**
 * RFC 4180 quoting: double the quotes, and quote any field carrying a comma, a
 * quote or a newline.
 *
 * Deliberately NOT also prefixing `=`, `+`, `-` and `@` to defuse spreadsheet
 * formula injection. The usual mitigation mangles exactly the data this file
 * exists to carry — the fixture's own `+44 20 7946 0958` is a leading `+` — and
 * the threat model does not support paying that: every value here originated in
 * Supreme's own export, and the only person who can reach this action is an
 * officer holding `members.view` downloading the council's own roster.
 */
function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function toRow(member: MemberListRow): string {
  return [
    member.membershipNumber,
    member.fullName,
    member.primaryEmail ?? '',
    member.phone ?? '',
    member.addressLine1 ?? '',
    member.city ?? '',
    member.state ?? '',
    member.postalCode ?? '',
    member.badAddress ? 'yes' : 'no',
    member.userId === null ? 'no' : 'yes',
    member.rosterLastSeenAt ?? '',
  ]
    .map(escapeCsv)
    .join(',');
}

/**
 * The roster as a spreadsheet, filtered by whatever the officer is currently
 * searching for.
 *
 * `members.view` is re-checked here rather than trusted from the page that
 * rendered the button: a Server Action is a public endpoint, reachable by
 * anybody who can post to it, and this one decrypts every member's address and
 * phone number. Permissions are read with the admin client because role grants
 * sit behind `roles.manage`-gated RLS — an officer cannot read their own — but
 * the RPC itself runs as the OFFICER, because `members_list` gates on
 * `kit.has_permission(...)` reading `auth.uid()`, which the service role does
 * not carry. See the fuller note in roster-actions.ts.
 */
export const exportMembersAction = enhanceAction(
  async (input: { search: string | null }, user): Promise<ExportResult> => {
    const permissions = await loadPermissionsForUser(
      getSupabaseServerAdminClient(),
      user.id,
    );

    if (!hasPermission(permissions, 'members', 'view')) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    const service = new MembersService(getSupabaseServerClient());
    const search = input.search === '' ? null : input.search;
    const rows: MemberListRow[] = [];

    let truncated = false;

    try {
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const page = await service.list(search, PAGE, offset);

        rows.push(...page);

        // A short page is the end of the results. A full one means there may
        // be more, and if the next offset would pass the cap the file is
        // incomplete — which the caller is told, not left to infer.
        if (page.length < PAGE) break;

        if (offset + PAGE >= MAX_ROWS) truncated = true;
      }
    } catch (cause) {
      return {
        success: false,
        error:
          cause instanceof Error && cause.message !== ''
            ? cause.message
            : 'The roster could not be read.',
      };
    }

    const csv = [HEADER.join(','), ...rows.map(toRow)].join('\r\n');

    return {
      success: true,
      // Dated, because an officer ends up with several of these in a downloads
      // folder and "members.csv (3)" tells them nothing.
      filename: `members-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      truncated,
    };
  },
  {},
);
