/** One request invites at most this many members. The list page holds 50. */
export const MAX_MEMBER_INVITES = 25;

export type MemberInviteRow = {
  memberId: string;
  name: string;
  outcome: 'invited' | 'skipped' | 'failed';
  detail: string;
};

export type MemberInviteResult =
  | { success: false; error: string }
  | { success: true; rows: MemberInviteRow[] };
