import type { RosterRecord } from '../types/roster';
import { mapHeaders, REQUIRED_HEADERS } from './column-map';
import type { SheetRow } from './roster-reader';
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

/**
 * Takes `SheetRow`s rather than bare `string[][]` so the row number comes from
 * the sheet instead of from the position in this array. Deriving it here — as
 * `offset + 2` once did — is only correct for a file with no blank lines in it,
 * and is wrong by one per blank line otherwise. `sourceRow` is the officer's
 * only handle on a 372-row spreadsheet, so being wrong sends them to an
 * innocent member; the type is what stops the number being dropped at the
 * reader/parser seam again.
 */
export function parseRoster(rows: SheetRow[]): ParseResult {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    return {
      records: [],
      missingHeaders: [...REQUIRED_HEADERS],
      rowErrors: [],
    };
  }

  const { index, missing } = mapHeaders(headerRow.cells);

  // A missing required header is fatal for the whole file. Returning early
  // means no preview is generated and nothing is written.
  if (missing.length > 0) {
    return { records: [], missingHeaders: missing, rowErrors: [] };
  }

  const records: RosterRecord[] = [];
  const rowErrors: RowError[] = [];

  dataRows.forEach((row) => {
    // The sheet's own number, so it survives blank lines above this row.
    const sourceRow = row.rowNumber;
    const at = (field: string): string | undefined =>
      index[field] === undefined ? undefined : row.cells[index[field]!];

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
