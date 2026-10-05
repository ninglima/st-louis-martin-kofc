/**
 * Adds `days` calendar days to an ISO `YYYY-MM-DD` date.
 *
 * The math runs in UTC on the date's own y/m/d components rather than on a
 * `Date` built from the browser's local zone: parsing `'2027-03-15'` with
 * `new Date('2027-03-15')` already lands on UTC midnight, but *mutating* it
 * with `setDate` (not `setUTCDate`) would shift by the caller's offset the
 * moment DST changes underneath the calculation. Doing the whole thing in UTC
 * sidesteps that class of off-by-one entirely.
 */
export function addDaysIso(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];

  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);

  return utc.toISOString().slice(0, 10);
}

export interface PeriodPreview {
  start: string;
  end: string;
}

/**
 * The dues period a payment recorded today would cover, mirroring
 * `kit.dues_next_period_start` (20260928120100_dues_writes.sql): start is
 * the member's paid-through date if they have one, else their acceptance
 * date, else there is nothing to preview -- `record_dues_payment` itself
 * refuses without an `accepted_on`.
 *
 * `end` is exclusive and exactly `start + 365` days, never "+1 year" -- the
 * database does the same fixed-day-count math, so the two never disagree
 * across a leap year the way "+1 year" would.
 */
export function periodPreview(
  paidThrough: string | null,
  acceptedOn: string | null,
): PeriodPreview | null {
  const start = paidThrough ?? acceptedOn;

  if (start === null) {
    return null;
  }

  return { start, end: addDaysIso(start, 365) };
}
