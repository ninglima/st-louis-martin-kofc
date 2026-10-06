'use server';

import * as z from 'zod';

import { sendEmail } from '@kit/email/resend';
import { enhanceAction } from '@kit/next/actions';
import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { MemberInviteResult } from '../lib/member-invite';
import { MEMBER_EDIT_FIELDS } from '../lib/member-edit';
import type { MemberEditChanges, MemberForEdit } from '../lib/member-edit';
import { renderMemberInvite } from '../templates/invite';
import { readMemberInvitesConfig } from './invite-config';
import {
  inviteRosterMembers,
  isInviteAlreadyRegistered,
  type InviteAuthAccount,
  type MemberInvitePorts,
} from './invite-members';
import { MembersService } from './members.service';
import type { MemberListFilters, MemberListRow } from './members.service';

/**
 * Next.js redacts thrown Server Action messages in production, so — as
 * everywhere else in this feature — the expected failures are RETURNED.
 */
export type ExportResult =
  | { success: true; filename: string; csv: string; truncated: boolean }
  | { success: false; error: string };

/**
 * `members_list` caps `p_limit` at 200 (`least(greatest(p_limit, 0), 200)`,
 * restated in 20260923084500_members_list_page_decrypt.sql), so an export of a
 * 372-member council is necessarily several calls. Asking for the ceiling is
 * right here and wrong on the screen: the list renders one page of 50 because
 * nobody reads 372 rows at once, whereas a spreadsheet is by definition the
 * whole filtered set.
 *
 * Since that migration each call decrypts its own 200 rows and no more. It
 * used to decrypt `p_offset + p_limit` of them, because the decryption sat in
 * the same query as the OFFSET — so the walk to the end of a 5,000-row roster
 * cost a measured 1,007 ms on its last page instead of the 44 ms it costs now,
 * and the total was quadratic in the size of the council.
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
 * The four characters Excel and Sheets treat as "this cell is a formula".
 *
 * Only two of them are defused here, and the omission is the point. `+` and
 * `-` are how real phone numbers in this roster begin — `+44 20 7946 0958` is
 * in the fixture, and `normalizePhone` deliberately leaves a non-US number
 * exactly as Supreme wrote it — so prefixing those would corrupt correct data
 * on every export to defend against a threat that has to come through an
 * officer's own upload. `=` and `@` lead no value in any column this file
 * carries: membership numbers, names, emails (where `@` is mid-string, and
 * only a LEADING `@` starts a formula), phones, addresses, a date and two
 * yes/no flags. Defusing them therefore costs nothing at all, which is a
 * different question from whether the threat is likely.
 */
const FORMULA_STARTERS = /^[=@]/;

/**
 * RFC 4180 quoting: double the quotes, and quote any field carrying a comma, a
 * quote or a newline. Plus the narrow formula defusal above.
 *
 * The apostrophe goes on BEFORE the quoting test, so a defused value that also
 * contains a comma still gets wrapped — and so the apostrophe itself lands
 * inside the quotes, where the spreadsheet reads it as "treat the rest as
 * text" rather than as part of the field separator grammar.
 */
function escapeCsv(value: string): string {
  const defused = FORMULA_STARTERS.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(defused)
    ? `"${defused.replaceAll('"', '""')}"`
    : defused;
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
  async (input: MemberListFilters, user): Promise<ExportResult> => {
    const permissions = await loadPermissionsForUser(
      getSupabaseServerAdminClient(),
      user.id,
    );

    if (!hasPermission(permissions, 'members', 'view')) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    const service = new MembersService(getSupabaseServerClient());

    // "The current filtered set", which is the whole point of the button: an
    // officer who has narrowed the screen to one city expects the file to be
    // that city, not the 372-row roster they were not looking at.
    const filters: MemberListFilters = {
      search: input.search === '' ? null : input.search,
      city: input.city === '' ? null : input.city,
      hasAccount: input.hasAccount ?? null,
    };

    const rows: MemberListRow[] = [];

    let truncated = false;

    try {
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const page = await service.list(filters, PAGE, offset);

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

const EDIT_UNAUTHORIZED = 'You do not have permission to edit members.';

// `.guid()` rather than `.uuid()`: the latter enforces the RFC 4122
// version/variant nibbles, which a hand-written test id need not satisfy,
// and which a real `gen_random_uuid()` row id always does anyway.
const MemberId = z.string().guid();

export type LoadForEditResult =
  | { success: true; member: MemberForEdit }
  | { success: false; error: string };

export type UpdateMemberResult =
  | { success: true }
  | { success: false; error: string };

async function canEditMembers(userId: string): Promise<boolean> {
  const permissions = await loadPermissionsForUser(
    getSupabaseServerAdminClient(),
    userId,
  );

  return hasPermission(permissions, 'members', 'manage');
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== ''
    ? cause.message
    : fallback;
}

const CHANGES_UNREADABLE = 'Those changes could not be read.';

/**
 * `input.changes` arrives as JSON off a public endpoint, so its shape is
 * only what `MemberEditChanges` promises TypeScript, not what a hand-built
 * request body actually contains. Checked before anything reaches
 * `member_update`, which trusts every key and value it is given.
 */
function isValidChanges(value: unknown): value is MemberEditChanges {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).every(
    ([key, fieldValue]) => {
      if (!(MEMBER_EDIT_FIELDS as readonly string[]).includes(key)) {
        return false;
      }

      return key === 'bad_address'
        ? typeof fieldValue === 'boolean'
        : typeof fieldValue === 'string' || fieldValue === null;
    },
  );
}

/**
 * `member_update` raises these two messages verbatim. `loadMemberForEditAction`
 * already reads the same words for a vanished member, via `getForEdit`'s null
 * return; this gives the save path the same wording, plus the permission
 * message already used for the RBAC check above. Every other message -- a
 * blank name, a bad email, an over-long value -- is already written for a
 * human and passes through unchanged.
 */
function mapEditError(message: string): string {
  if (message === 'unknown member') return 'That member no longer exists.';
  if (message === 'forbidden') return EDIT_UNAUTHORIZED;

  return message;
}

/**
 * The dialog's initial values. `members.manage` is re-checked here because a
 * Server Action is a public endpoint, and this one returns decrypted
 * addresses and phones. The RPC runs as the officer, whose `auth.uid()` is
 * what `member_for_edit` checks.
 */
export const loadMemberForEditAction = enhanceAction(
  async (input: { memberId: string }, user): Promise<LoadForEditResult> => {
    if (!(await canEditMembers(user.id))) {
      return { success: false, error: EDIT_UNAUTHORIZED };
    }

    if (!MemberId.safeParse(input.memberId).success) {
      return { success: false, error: 'That member no longer exists.' };
    }

    try {
      const member = await new MembersService(
        getSupabaseServerClient(),
      ).getForEdit(input.memberId);

      return member
        ? { success: true, member }
        : { success: false, error: 'That member no longer exists.' };
    } catch (cause) {
      return {
        success: false,
        error: messageOf(cause, 'The member could not be loaded.'),
      };
    }
  },
  {},
);

/** Saves the changed fields. `member_update` is the authority on validation. */
export const updateMemberAction = enhanceAction(
  async (
    input: { memberId: string; changes: MemberEditChanges },
    user,
  ): Promise<UpdateMemberResult> => {
    if (!(await canEditMembers(user.id))) {
      return { success: false, error: EDIT_UNAUTHORIZED };
    }

    if (!MemberId.safeParse(input.memberId).success) {
      return { success: false, error: 'That member no longer exists.' };
    }

    if (!isValidChanges(input.changes)) {
      return { success: false, error: CHANGES_UNREADABLE };
    }

    if (Object.keys(input.changes).length === 0) {
      return { success: true };
    }

    try {
      await new MembersService(getSupabaseServerClient()).update(
        input.memberId,
        input.changes,
      );

      return { success: true };
    } catch (cause) {
      return {
        success: false,
        error: mapEditError(messageOf(cause, 'The member could not be saved.')),
      };
    }
  },
  {},
);

const INVITE_UNAUTHORIZED = 'You do not have permission to invite members.';

const InviteIds = z.object({
  memberIds: z.array(z.string().guid()).min(1).max(25),
});

/**
 * Emails the address already on each roster row and links that login to
 * the member. `users.manage` is re-checked here because a Server Action is
 * a public endpoint. The link RPC checks it again against `auth.uid()`.
 */
export const inviteMembersAction = enhanceAction(
  async (input: unknown, user): Promise<MemberInviteResult> => {
    if (!(await canInviteMembers(user.id))) {
      return { success: false, error: INVITE_UNAUTHORIZED };
    }

    const parsed = InviteIds.safeParse(input);

    if (!parsed.success) {
      return { success: false, error: 'Select members to invite.' };
    }

    const config = readMemberInvitesConfig();

    return inviteRosterMembers(
      parsed.data.memberIds,
      invitePorts(config.siteUrl),
      config,
    );
  },
  {},
);

async function canInviteMembers(userId: string): Promise<boolean> {
  const permissions = await loadPermissionsForUser(
    getSupabaseServerAdminClient(),
    userId,
  );

  return hasPermission(permissions, 'users', 'manage');
}

function invitePorts(siteUrl: string): MemberInvitePorts {
  const officer = getSupabaseServerClient();
  const admin = getSupabaseServerAdminClient();

  return {
    async loadMembers(ids) {
      const { data, error } = await officer
        .from('members')
        .select('id, primary_email, user_id, bad_address, first_name, last_name')
        .in('id', ids);

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id,
        primaryEmail: row.primary_email,
        userId: row.user_id,
        badAddress: row.bad_address,
        firstName: row.first_name,
        lastName: row.last_name,
      }));
    },

    async ownerOf(userId) {
      const { data, error } = await officer
        .from('members')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw new Error(error.message);

      return data?.id ?? null;
    },

    async link(memberId, userId) {
      const { error } = await officer.rpc('member_link_sign_in', {
        p_member_id: memberId,
        p_user_id: userId,
      });

      if (error) throw new Error(error.message);
    },

    async getUser(id) {
      const { data, error } = await admin.auth.admin.getUserById(id);

      if (error || !data.user) return null;

      return toAccount(data.user);
    },

    async generateLink(input) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: input.type,
        email: input.email,
        options: { redirectTo: `${siteUrl}/update-password` },
      });

      if (error || !data.user || !data.properties?.hashed_token) {
        return {
          ok: false,
          alreadyRegistered: isInviteAlreadyRegistered(error),
          error: error?.message ?? 'The invite link could not be created.',
        };
      }

      return {
        ok: true,
        link: {
          user: toAccount(data.user),
          tokenHash: data.properties.hashed_token,
          verificationType: data.properties.verification_type,
        },
      };
    },

    async send(input) {
      const config = readMemberInvitesConfig();
      const rendered = renderMemberInvite({
        firstName: input.firstName,
        url: input.url,
      });
      const sent = await sendEmail(config.apiKey, {
        from: config.from,
        to: input.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [{ name: 'kind', value: 'member_invite' }],
      });

      return sent.ok ? { ok: true } : { ok: false, error: sent.error };
    },
  };
}

function toAccount(user: {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
}): InviteAuthAccount {
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
  };
}
