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

export function mapHeaders(headerRow: string[]): HeaderMap {
  const index: Record<string, number> = {};

  headerRow.forEach((raw, position) => {
    const field = HEADER_TO_FIELD[(raw ?? '').trim().toLowerCase()];
    // Unrecognized columns are ignored silently; first occurrence wins.
    if (field !== undefined && index[field] === undefined) {
      index[field] = position;
    }
  });

  const missing = REQUIRED_HEADERS.filter(
    (header) => index[HEADER_TO_FIELD[header.toLowerCase()]!] === undefined,
  );

  return { index, missing };
}
