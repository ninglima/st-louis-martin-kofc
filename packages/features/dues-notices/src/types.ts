export type NoticeKind = 'before_30' | 'due_date' | 'after_30';
export type NoticesMode = 'off' | 'dry_run' | 'live';
export type Tracking =
  | 'pending'
  | 'dry_run'
  | 'failed'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained';

export interface ClaimedNotice {
  noticeId: string;
  memberId: string;
  firstName: string;
  email: string;
  kind: NoticeKind;
  /** Exclusive paid-through (or acceptance) date, YYYY-MM-DD. */
  cycleDate: string;
  firstDues: boolean;
  levelName: string;
  amountCents: number;
}

export interface NoticeRow {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  email: string;
  kind: NoticeKind;
  cycleDate: string;
  status: string;
  tracking: Tracking;
  sentAt: string | null;
  createdAt: string;
}

export interface LastNotice {
  memberId: string;
  kind: NoticeKind;
  sentAt: string;
  tracking: Tracking;
}

export interface NoticeRun {
  ranAt: string;
  mode: NoticesMode;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  error: string | null;
}

export interface Unreachable {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  reason: 'no_email' | 'bounced' | 'complained';
  detail: string | null;
}

export type NoticesActionResult =
  | { success: true }
  | { success: false; error: string };
