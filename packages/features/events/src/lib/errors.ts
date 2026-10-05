/** Database errors as sentences for a toast. `P0001` messages are written for people. */
export function toMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  const e = error as { code?: string; message?: string } | null;

  switch (e?.code) {
    case '42501':
      return 'You do not have permission to do that.';
    case 'P0001':
      return e.message || fallback;
    case '23505':
      return 'That already exists.';
    case '22P02':
    case '22007':
    case '22008':
      return 'Some of the details are not valid.';
    default:
      return fallback;
  }
}
