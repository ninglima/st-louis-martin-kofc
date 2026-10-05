/** Who made a payment, as the Payments table shows it. */
export interface Payer {
  name: string;
  /** The member record to link to, or null when the sign-in has none. */
  memberId: string | null;
}

interface MemberRow {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
}

interface AccountRow {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * Names each payer (keyed by the payment's `user_id`): their member record
 * when the sign-in is linked to one, otherwise the account's name or email.
 */
export function resolvePayers(
  userIds: string[],
  members: MemberRow[],
  accounts: AccountRow[],
): Record<string, Payer> {
  const payers: Record<string, Payer> = {};

  for (const userId of userIds) {
    const member = members.find((row) => row.user_id === userId);

    if (member) {
      payers[userId] = {
        name: `${member.first_name} ${member.last_name}`.trim(),
        memberId: member.id,
      };
      continue;
    }

    const account = accounts.find((row) => row.id === userId);

    payers[userId] = {
      name: account?.name || account?.email || 'Deleted user',
      memberId: null,
    };
  }

  return payers;
}
