/**
 * Parses `EMAIL_ALLOWLIST`: a comma-separated list of addresses.
 * Returns `null` when unset or empty (unrestricted). A non-empty list
 * restricts live sends to those addresses only (case-insensitive).
 */
export function parseEmailAllowlist(
  raw: string | undefined,
): ReadonlySet<string> | null {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return null;

  return new Set(parts);
}

/** When `allowlist` is null, every address is allowed. */
export function isEmailAllowlisted(
  email: string,
  allowlist: ReadonlySet<string> | null,
): boolean {
  if (!allowlist) return true;

  return allowlist.has(email.trim().toLowerCase());
}

export const NOT_ON_ALLOWLIST_ERROR = 'not on EMAIL_ALLOWLIST';
