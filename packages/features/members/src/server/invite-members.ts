import 'server-only';

import { isEmailAllowlisted } from '@kit/email/allowlist';
import { isPlausibleEmail } from '@kit/email/email-format';

import { MAX_MEMBER_INVITES } from '../lib/member-invite';
import type { MemberInviteResult, MemberInviteRow } from '../lib/member-invite';
import {
  memberInviteConfirmUrl,
  renderMemberInvite,
} from '../templates/invite';
import type { MemberInvitesConfig } from './invite-config';

export const INVITES_OFF = 'Member invites are turned off.';
export const INVITES_UNCONFIGURED = 'Member invites are not configured.';
export const INVITE_TOO_MANY = 'Invite up to 25 members at a time.';
export const INVITE_NONE = 'Select members to invite.';

const NO_EMAIL = 'No email on file.';
const BAD_ADDRESS = 'Supreme has marked this address as undeliverable.';
const INVALID_EMAIL = 'The email on file is not a valid address.';
const ALREADY_SIGNED_IN = 'Already signed in.';
const OWNED_BY_ANOTHER = 'This email already belongs to another member.';
const EMAIL_MISMATCH = 'The sign-in email does not match the roster.';
const NOT_ALLOWLISTED = 'That address is not on the email allowlist.';
const MISSING_MEMBER = 'That member no longer exists.';
const MISSING_SIGN_IN = 'The sign-in on this member could not be found.';
const DRY_RUN = 'Dry run: no email was sent.';
const SENT = 'Invite sent.';

export interface InviteMemberRecord {
  id: string;
  primaryEmail: string | null;
  userId: string | null;
  badAddress: boolean;
  firstName: string;
  lastName: string;
}

export interface InviteAuthAccount {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
}

export interface InviteGeneratedLink {
  user: InviteAuthAccount;
  tokenHash: string;
  verificationType: string;
}

export interface MemberInvitePorts {
  loadMembers(ids: string[]): Promise<InviteMemberRecord[]>;
  /** The member id that already holds this login, or null. */
  ownerOf(userId: string): Promise<string | null>;
  link(memberId: string, userId: string): Promise<void>;
  getUser(id: string): Promise<InviteAuthAccount | null>;
  generateLink(input: {
    type: 'invite' | 'recovery';
    email: string;
  }): Promise<
    | { ok: true; link: InviteGeneratedLink }
    | { ok: false; alreadyRegistered: boolean; error: string }
  >;
  send(input: {
    to: string;
    firstName: string;
    url: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
}

export async function inviteRosterMembers(
  ids: string[],
  ports: MemberInvitePorts,
  config: MemberInvitesConfig,
): Promise<MemberInviteResult> {
  if (ids.length === 0) return { success: false, error: INVITE_NONE };

  if (ids.length > MAX_MEMBER_INVITES) {
    return { success: false, error: INVITE_TOO_MANY };
  }

  if (config.mode === 'off') return { success: false, error: INVITES_OFF };

  if (config.mode === 'live' && config.missingForLive.length > 0) {
    return { success: false, error: INVITES_UNCONFIGURED };
  }

  const loaded = await ports.loadMembers(ids);
  const byId = new Map(loaded.map((member) => [member.id, member]));
  const rows: MemberInviteRow[] = [];

  for (const id of ids) {
    const member = byId.get(id);

    rows.push(
      member
        ? await inviteOne(member, ports, config)
        : { memberId: id, name: 'Member', outcome: 'failed', detail: MISSING_MEMBER },
    );
  }

  return { success: true, rows };
}

async function inviteOne(
  member: InviteMemberRecord,
  ports: MemberInvitePorts,
  config: MemberInvitesConfig,
): Promise<MemberInviteRow> {
  const name = displayName(member);
  const fail = (detail: string): MemberInviteRow => ({
    memberId: member.id,
    name,
    outcome: 'failed',
    detail,
  });

  const email = member.primaryEmail?.trim() ?? '';

  if (email === '') return fail(NO_EMAIL);
  if (!isPlausibleEmail(email)) return fail(INVALID_EMAIL);
  if (member.badAddress) return fail(BAD_ADDRESS);

  if (
    config.mode === 'live' &&
    !isEmailAllowlisted(email, config.allowlist)
  ) {
    return fail(NOT_ALLOWLISTED);
  }

  const prepared = await prepareLink(member, email, ports);

  if (prepared.outcome !== 'ready') {
    return { memberId: member.id, name, ...prepared };
  }

  if (config.mode === 'dry_run') {
    return { memberId: member.id, name, outcome: 'invited', detail: DRY_RUN };
  }

  const url = memberInviteConfirmUrl(
    config.siteUrl,
    prepared.link.tokenHash,
    prepared.link.verificationType,
  );
  const sent = await ports.send({ to: email, firstName: member.firstName, url });

  if (!sent.ok) return fail(sent.error);

  return { memberId: member.id, name, outcome: 'invited', detail: SENT };
}

type Prepared =
  | { outcome: 'ready'; link: InviteGeneratedLink }
  | { outcome: 'skipped' | 'failed'; detail: string };

async function prepareLink(
  member: InviteMemberRecord,
  email: string,
  ports: MemberInvitePorts,
): Promise<Prepared> {
  if (member.userId) {
    const user = await ports.getUser(member.userId);

    if (!user) return { outcome: 'failed', detail: MISSING_SIGN_IN };
    if (user.emailConfirmedAt) return { outcome: 'skipped', detail: ALREADY_SIGNED_IN };
    if (!sameEmail(user.email, email)) {
      return { outcome: 'failed', detail: EMAIL_MISMATCH };
    }

    return generated(await ports.generateLink({ type: 'recovery', email }));
  }

  const invited = await ports.generateLink({ type: 'invite', email });

  if (invited.ok) {
    const linked = await linkOrFail(ports, member.id, invited.link.user.id);

    return linked ?? { outcome: 'ready', link: invited.link };
  }

  if (!invited.alreadyRegistered) {
    return { outcome: 'failed', detail: invited.error };
  }

  const recovered = await ports.generateLink({ type: 'recovery', email });

  if (!recovered.ok) return { outcome: 'failed', detail: recovered.error };
  if (recovered.link.user.emailConfirmedAt) {
    return { outcome: 'skipped', detail: ALREADY_SIGNED_IN };
  }

  const owner = await ports.ownerOf(recovered.link.user.id);

  if (owner && owner !== member.id) {
    return { outcome: 'failed', detail: OWNED_BY_ANOTHER };
  }

  const linked = await linkOrFail(ports, member.id, recovered.link.user.id);

  return linked ?? { outcome: 'ready', link: recovered.link };
}

function generated(
  result: Awaited<ReturnType<MemberInvitePorts['generateLink']>>,
): Prepared {
  if (!result.ok) return { outcome: 'failed', detail: result.error };

  return { outcome: 'ready', link: result.link };
}

async function linkOrFail(
  ports: MemberInvitePorts,
  memberId: string,
  userId: string,
): Promise<Prepared | null> {
  try {
    await ports.link(memberId, userId);

    return null;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    if (message.includes('another member')) {
      return { outcome: 'failed', detail: OWNED_BY_ANOTHER };
    }

    return { outcome: 'failed', detail: message || MISSING_MEMBER };
  }
}

function displayName(member: InviteMemberRecord): string {
  return `${member.firstName} ${member.lastName}`.trim() || 'Member';
}

function sameEmail(left: string | null, right: string): boolean {
  return (left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
}

export function isInviteAlreadyRegistered(error: {
  message: string;
  code?: string;
} | null): boolean {
  if (!error) return false;

  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    /already (been )?registered|already exists/i.test(error.message)
  );
}
