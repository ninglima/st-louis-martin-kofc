import { describe, expect, it, vi } from 'vitest';

import type { MemberInvitesConfig } from './invite-config';
import { readMemberInvitesConfig } from './invite-config';
import {
  inviteRosterMembers,
  type InviteAuthAccount,
  type InviteGeneratedLink,
  type InviteMemberRecord,
  type MemberInvitePorts,
} from './invite-members';

const MEMBER = 'bd1d9c3a-1111-2222-3333-444455556666';
const OTHER = 'cd1d9c3a-1111-2222-3333-444455556667';
const USER = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

function liveConfig(
  overrides: Partial<MemberInvitesConfig> = {},
): MemberInvitesConfig {
  return {
    mode: 'live',
    apiKey: 're_test',
    from: 'Council <council@example.org>',
    siteUrl: 'https://portal.example.org',
    allowlist: null,
    missingForLive: [],
    ...overrides,
  };
}

function member(
  overrides: Partial<InviteMemberRecord> = {},
): InviteMemberRecord {
  return {
    id: MEMBER,
    primaryEmail: 'ada@example.com',
    userId: null,
    badAddress: false,
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  };
}

function account(
  overrides: Partial<InviteAuthAccount> = {},
): InviteAuthAccount {
  return {
    id: USER,
    email: 'ada@example.com',
    emailConfirmedAt: null,
    ...overrides,
  };
}

function linkFor(
  type: 'invite' | 'recovery',
  user: InviteAuthAccount = account(),
): InviteGeneratedLink {
  return {
    user,
    tokenHash: `hash-${type}`,
    verificationType: type,
  };
}

function ports(
  record: InviteMemberRecord | null,
  options: {
    user?: InviteAuthAccount | null;
    owner?: string | null;
    invite?: 'ok' | 'taken' | 'error';
  } = {},
) {
  const generateLink = vi.fn(
    async (input: { type: 'invite' | 'recovery'; email: string }) => {
      if (input.type === 'invite' && options.invite === 'taken') {
        return {
          ok: false as const,
          alreadyRegistered: true,
          error: 'already registered',
        };
      }

      if (input.type === 'invite' && options.invite === 'error') {
        return {
          ok: false as const,
          alreadyRegistered: false,
          error: 'auth unavailable',
        };
      }

      return {
        ok: true as const,
        link: linkFor(input.type, options.user ?? account()),
      };
    },
  );
  const link = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ ok: true as const }));
  const getUser = vi.fn(async () =>
    options.user === undefined ? account() : options.user,
  );

  const fake: MemberInvitePorts = {
    loadMembers: async () => (record ? [record] : []),
    ownerOf: async () => options.owner ?? null,
    link,
    getUser,
    generateLink,
    send,
  };

  return { fake, generateLink, link, send };
}

describe('readMemberInvitesConfig', () => {
  it('defaults to off and names what live mode still needs', () => {
    const config = readMemberInvitesConfig({});

    expect(config.mode).toBe('off');
    expect(config.missingForLive).toEqual([
      'RESEND_API_KEY',
      'MEMBER_INVITES_FROM',
      'NEXT_PUBLIC_SITE_URL',
    ]);
  });
});

describe('inviteRosterMembers', () => {
  it('refuses the batch when invites are turned off', async () => {
    const { fake, generateLink } = ports(member());

    const result = await inviteRosterMembers(
      [MEMBER],
      fake,
      liveConfig({ mode: 'off' }),
    );

    expect(result).toEqual({
      success: false,
      error: 'Member invites are turned off.',
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('fails a row with no email and continues', async () => {
    const { fake, send } = ports(member({ primaryEmail: null }));

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(result).toEqual({
      success: true,
      rows: [
        {
          memberId: MEMBER,
          name: 'Ada Lovelace',
          outcome: 'failed',
          detail: 'No email on file.',
        },
      ],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails a row Supreme has marked undeliverable', async () => {
    const { fake, generateLink } = ports(member({ badAddress: true }));

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(result.success && result.rows[0]?.detail).toBe(
      'Supreme has marked this address as undeliverable.',
    );
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('skips a member who has already confirmed their sign-in', async () => {
    const { fake, generateLink, send } = ports(
      member({ userId: USER }),
      { user: account({ emailConfirmedAt: '2026-10-01T00:00:00Z' }) },
    );

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(result.success && result.rows[0]).toMatchObject({
      outcome: 'skipped',
      detail: 'Already signed in.',
    });
    expect(generateLink).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a recovery link for an unconfirmed login and does not create one', async () => {
    const { fake, generateLink, link, send } = ports(
      member({ userId: USER }),
      { user: account() },
    );

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'ada@example.com',
    });
    expect(link).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      to: 'ada@example.com',
      firstName: 'Ada',
      url: 'https://portal.example.org/auth/confirm?token_hash=hash-recovery&type=recovery&callback=https%3A%2F%2Fportal.example.org%2Fupdate-password',
    });
    expect(result.success && result.rows[0]?.outcome).toBe('invited');
  });

  it('creates an invite link and links a member who has no login', async () => {
    const { fake, generateLink, link, send } = ports(member(), {
      invite: 'ok',
    });

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(generateLink).toHaveBeenCalledWith({
      type: 'invite',
      email: 'ada@example.com',
    });
    expect(link).toHaveBeenCalledWith(MEMBER, USER);
    expect(send).toHaveBeenCalled();
    expect(result.success && result.rows[0]?.detail).toBe('Invite sent.');
  });

  it('fails when the address already belongs to another member', async () => {
    const { fake, link, send } = ports(member(), {
      invite: 'taken',
      owner: OTHER,
      user: account(),
    });

    const result = await inviteRosterMembers([MEMBER], fake, liveConfig());

    expect(result.success && result.rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'This email already belongs to another member.',
    });
    expect(link).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not call Resend in dry run', async () => {
    const { fake, generateLink, send } = ports(member({ userId: USER }));

    const result = await inviteRosterMembers(
      [MEMBER],
      fake,
      liveConfig({ mode: 'dry_run' }),
    );

    expect(generateLink).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(result.success && result.rows[0]?.detail).toBe(
      'Dry run: no email was sent.',
    );
  });

  it('refuses a live send to an address outside the allowlist', async () => {
    const { fake, generateLink } = ports(member());

    const result = await inviteRosterMembers(
      [MEMBER],
      fake,
      liveConfig({ allowlist: new Set(['other@example.com']) }),
    );

    expect(result.success && result.rows[0]?.detail).toBe(
      'That address is not on the email allowlist.',
    );
    expect(generateLink).not.toHaveBeenCalled();
  });
});
