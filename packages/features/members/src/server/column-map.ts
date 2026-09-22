/**
 * Header text -> field name. Matched by name, case-insensitively and trimmed,
 * never by position: a future Officers Online export could reorder columns and
 * a positional reader would silently import addresses into phone fields.
 */
const HEADER_TO_FIELD: Record<string, string> = {
  'membership number': 'membershipNumber',
  prefix: 'prefix',
  'first name': 'firstName',
  'middle name': 'middleName',
  'last name': 'lastName',
  suffix: 'suffix',
  'fraternal - bad address': 'badAddress',
  'primary type': 'primaryType',
  'address line 1': 'addressLine1',
  'address line 2': 'addressLine2',
  city: 'city',
  'state/province': 'state',
  'postal code': 'postalCode',
  country: 'country',
  'secondary type': 'secondaryType',
  'address line 1 (secondary)': 'secondaryAddressLine1',
  'address line 2 (secondary)': 'secondaryAddressLine2',
  'city (secondary)': 'secondaryCity',
  'state/province (secondary)': 'secondaryState',
  'postal code (secondary)': 'secondaryPostalCode',
  'country (secondary)': 'secondaryCountry',
  'residence phone': 'residencePhone',
  'business phone': 'businessPhone',
  'cell phone': 'cellPhone',
  'primary email': 'primaryEmail',
  'secondary email': 'secondaryEmail',
  'tertiary email': 'tertiaryEmail',
};

export const REQUIRED_HEADERS = [
  'Membership Number',
  'First Name',
  'Last Name',
  'Primary Email',
] as const;

export interface HeaderMap {
  /** field name -> column index */
  index: Record<string, number>;
  /** required headers absent from the file, in REQUIRED_HEADERS order */
  missing: string[];
}

/**
 * Trims, lowercases, and collapses any run of internal whitespace (spaces,
 * tabs, newlines) to a single space. Export formatting variance — a header
 * reflowed with a double space or a tab — must not silently drop a column
 * from `index`; that is the exact failure mode this file exists to prevent.
 */
function normalizeHeaderText(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const NORMALIZED_HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(HEADER_TO_FIELD).map(([header, field]) => [
    normalizeHeaderText(header),
    field,
  ]),
);

export function mapHeaders(headerRow: string[]): HeaderMap {
  const index: Record<string, number> = {};

  headerRow.forEach((raw, position) => {
    const field = NORMALIZED_HEADER_TO_FIELD[normalizeHeaderText(raw)];
    // Unrecognized columns are ignored silently; first occurrence wins.
    if (field !== undefined && index[field] === undefined) {
      index[field] = position;
    }
  });

  const missing = REQUIRED_HEADERS.filter(
    (header) =>
      index[NORMALIZED_HEADER_TO_FIELD[normalizeHeaderText(header)]!] ===
      undefined,
  );

  return { index, missing };
}
