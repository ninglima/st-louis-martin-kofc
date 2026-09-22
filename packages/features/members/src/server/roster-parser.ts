import type { RosterRecord } from '../types/roster';
import { mapHeaders, REQUIRED_HEADERS } from './column-map';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from './normalize';

export interface RowError {
  sourceRow: number;
  reason: string;
}

export interface ParseResult {
  records: RosterRecord[];
  missingHeaders: string[];
  rowErrors: RowError[];
}

/**
 * Deliberately permissive: this matches what Supabase auth will accept rather
 * than trying to be a full RFC validator. A row this rejects could never
 * become an account, so rejecting it here is the same answer, earlier.
 */
function isUsableEmail(value: string | null): value is string {
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseRoster(rows: string[][]): ParseResult {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    return {
      records: [],
      missingHeaders: [...REQUIRED_HEADERS],
      rowErrors: [],
    };
  }

  const { index, missing } = mapHeaders(headerRow);

  // A missing required header is fatal for the whole file. Returning early
  // means no preview is generated and nothing is written.
  if (missing.length > 0) {
    return { records: [], missingHeaders: missing, rowErrors: [] };
  }

  const records: RosterRecord[] = [];
  const rowErrors: RowError[] = [];

  dataRows.forEach((row, offset) => {
    // +2: one for the header row, one to make it 1-based like Excel shows.
    const sourceRow = offset + 2;
    const at = (field: string): string | undefined =>
      index[field] === undefined ? undefined : row[index[field]!];

    const membershipNumber = (at('membershipNumber') ?? '').trim();

    if (membershipNumber === '') {
      rowErrors.push({ sourceRow, reason: 'Cannot identify the member' });
      return;
    }

    const primaryEmail = normalizeEmail(at('primaryEmail'));

    if (!isUsableEmail(primaryEmail)) {
      rowErrors.push({
        sourceRow,
        reason: `No usable email address for member ${membershipNumber} — create this account manually`,
      });
      return;
    }

    const secondaryCity = normalizeName(at('secondaryCity'));
    const secondaryAddress =
      secondaryCity === null
        ? null
        : {
            line1: normalizeName(at('secondaryAddressLine1')) ?? '',
            city: secondaryCity,
            state: normalizeState(at('secondaryState')) ?? '',
            postalCode: normalizeZip(at('secondaryPostalCode')) ?? '',
            country: normalizeName(at('secondaryCountry')) ?? '',
            // The header map exposes this (values like "Seasonal" in the real
            // extract); without it here the marker is silently dropped.
            type: normalizeName(at('secondaryType')) ?? '',
          };

    records.push({
      membershipNumber,
      prefix: normalizeName(at('prefix')),
      firstName: normalizeName(at('firstName')) ?? '',
      middleName: normalizeName(at('middleName')),
      lastName: normalizeName(at('lastName')) ?? '',
      suffix: normalizeName(at('suffix')),
      primaryEmail,
      emailSecondary: normalizeEmail(at('secondaryEmail')),
      addressLine1: normalizeName(at('addressLine1')),
      addressLine2: normalizeName(at('addressLine2')),
      city: normalizeName(at('city')),
      state: normalizeState(at('state')),
      postalCode: normalizeZip(at('postalCode')),
      country: normalizeName(at('country')),
      primaryType: normalizeName(at('primaryType')),
      phoneCell: normalizePhone(at('cellPhone')),
      phoneResidence: normalizePhone(at('residencePhone')),
      phoneBusiness: normalizePhone(at('businessPhone')),
      secondaryAddress,
      // Deliberately strict: only the literal marker the real extract uses.
      // kit.roster_bad_address() in the database accepts a wider truthy
      // vocabulary (X, Y, YES, T, TRUE, 1) and reads anything else non-empty
      // as false, so if a future export switches markers this comparison
      // must be updated too or the flag silently reads false for everyone.
      badAddress: (at('badAddress') ?? '').trim().toUpperCase() === 'X',
      sourceRow,
    });
  });

  return { records, missingHeaders: [], rowErrors };
}
