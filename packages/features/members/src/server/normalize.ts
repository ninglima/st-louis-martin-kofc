const US_STATES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
  'AA',
  'AE',
  'AP',
]);

function blankToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeEmail(
  value: string | undefined | null,
): string | null {
  const trimmed = blankToNull(value);
  return trimmed === null ? null : trimmed.toLowerCase();
}

/**
 * Digits-only US numbers are formatted `(703) 477-4236`. Anything else is
 * returned trimmed but otherwise untouched: a number we cannot confidently
 * parse is better stored as the officer sees it than reshaped into something
 * that looks right and dials wrong.
 */
export function normalizePhone(
  value: string | undefined | null,
): string | null {
  const trimmed = blankToNull(value);
  if (trimmed === null) return null;

  const digits = trimmed.replace(/\D/g, '');
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (local.length !== 10) return trimmed;

  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function normalizeState(
  value: string | undefined | null,
): string | null {
  const trimmed = blankToNull(value);
  if (trimmed === null) return null;

  const upper = trimmed.toUpperCase();
  return US_STATES.has(upper) ? upper : null;
}

/** Preserved as-is, including ZIP+4, which the entire real sample uses. */
export function normalizeZip(value: string | undefined | null): string | null {
  return blankToNull(value);
}

/** Trimmed only. Case is deliberately untouched — see normalize.test.ts. */
export function normalizeName(value: string | undefined | null): string | null {
  return blankToNull(value);
}
