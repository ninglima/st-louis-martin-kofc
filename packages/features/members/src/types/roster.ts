/**
 * Plan rows applied per call to `applyRosterChunkAction`.
 *
 * It lives here rather than beside the action for two reasons. A `'use server'`
 * module may only export async functions, so the action cannot export a number
 * at all. And the browser's apply loop has to advance by exactly the figure the
 * action slices by: a loop that steps further than the action applied silently
 * skips members, and one that steps less never terminates. One exported
 * constant makes those two numbers the same number.
 */
export const CHUNK_SIZE = 25;

/** One roster row after normalization. All fields trimmed; empty means null. */
export interface RosterRecord {
  membershipNumber: string;
  prefix: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  primaryEmail: string | null;
  emailSecondary: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  primaryType: string | null;
  phoneCell: string | null;
  phoneResidence: string | null;
  phoneBusiness: string | null;
  secondaryAddress: Record<string, string> | null;
  badAddress: boolean;
  /** 1-based row number in the source file, for error reporting. */
  sourceRow: number;
}
