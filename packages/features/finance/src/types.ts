import type { DuesStatus } from '@kit/dues/types';

export interface HostingProvider {
  slug: string;
  name: string;
}

export interface HostingCost {
  id: string;
  provider: string;
  providerName: string;
  amountCents: number;
  paidOn: string;
  periodStart: string;
  /** Exclusive. */
  periodEnd: string;
  note: string | null;
  recordedByEmail: string | null;
  updatedAt: string;
}

export interface LatestBill {
  provider: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
}

export interface HostingCostInput {
  id: string | null;
  provider: string;
  amountCents: number;
  paidOn: string;
  periodStart: string;
  /** Exclusive. */
  periodEnd: string;
  note: string | null;
}

export type StatusCounts = Record<DuesStatus, number>;

export interface FinanceDashboard {
  year: number;
  yearStart: string;
  yearEnd: string;
  isCurrentYear: boolean;
  today: string;
  duesCollectedCents: number;
  outstandingCents: number;
  collection: { numerator: number; denominator: number };
  statusCounts: StatusCounts;
  hostingToDateCents: number;
  hostingProjectionCents: number | null;
  duesByMonth: {
    month: string;
    onlineCents: number;
    checkCents: number;
    cashCents: number;
  }[];
  hostingByMonth: { month: string; provider: string; cents: number }[];
}

export interface NetYear {
  year: number;
  duesCents: number;
  hostingCents: number;
}

export interface FollowUpRow {
  memberId: string;
  firstName: string;
  lastName: string;
  membershipNumber: string;
  duesStatus: DuesStatus;
  paidThrough: string | null;
  levelName: string;
  amountCents: number;
}

export interface PaymentToCheck {
  paymentId: string;
  createdAt: string;
  memberId: string | null;
  memberName: string | null;
  duesLevel: string | null;
  amountCents: number;
  provider: string;
}

export type FinanceActionResult =
  | { success: true }
  | { success: false; error: string };
