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
