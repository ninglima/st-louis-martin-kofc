import type { Database } from '@kit/supabase/database';

export const DUES_METHODS_FS = ['check', 'cash', 'waived'] as const;
export type DuesMethodFs = (typeof DUES_METHODS_FS)[number];
export type DuesMethod = DuesMethodFs | 'online' | 'opening_balance';
export type DuesStatus =
  | 'no_record'
  | 'due'
  | 'lapsed'
  | 'due_soon'
  | 'current';

export interface DuesLevel {
  slug: string;
  name: string;
  amountCents: number;
  selfService: boolean;
}

export interface MemberDuesSummary {
  memberId: string;
  duesLevel: string;
  levelName: string;
  amountCents: number;
  acceptedOn: string | null;
  isStudent: boolean;
  paidThrough: string | null;
  duesStatus: DuesStatus;
}

/**
 * The signed-in member's own summary, plus the flags of their ASSIGNED level
 * read without the `active` filter -- `availableDuesLevels` needs to tell an
 * inactive FS-assigned non-self-service level apart from a self-service one,
 * and `DuesService.levels()` (active only) cannot.
 */
export interface MyDuesSummary extends MemberDuesSummary {
  levelSelfService: boolean;
  levelActive: boolean;
}

export interface DuesLedgerRow {
  id: string;
  level: string;
  levelName: string;
  amountCents: number;
  method: DuesMethod;
  checkNumber: string | null;
  receivedOn: string;
  periodStart: string;
  periodEnd: string;
  recordedByEmail: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * `my_dues_ledger()`'s actual row shape -- narrower than `DuesLedgerRow`.
 * It returns no `level` slug, `check_number`, `recorded_by_email`,
 * `created_at`, or `void_reason` (see `20260928120000_dues_model.sql` and
 * the hand-corrected `my_dues_ledger` entry in `database.types.ts`), so it
 * is typed directly off the generated RPC return rather than fabricating
 * fields the RPC never sends.
 */
export type MyLedgerRow =
  Database['public']['Functions']['my_dues_ledger']['Returns'][number];
