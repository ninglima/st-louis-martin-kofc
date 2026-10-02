import type { DuesStatus } from '../types';

/**
 * Every status except `current` is offered checkout. `no_record` included:
 * an online payment for a member with neither a paid period nor an
 * acceptance date starts its period on the day it is received (see
 * `dues_online_and_load.sql`), so there is no period to get wrong.
 */
export function isPayable(status: DuesStatus): boolean {
  return status !== 'current';
}

/** `'2027-08-01'` -> `'August 1, 2027'`, read as a calendar date in UTC so the
 * day never shifts with the viewer's time zone. */
export function formatDueDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const DAY_MS = 86_400_000;

  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** `0` -> `'today'`, `1` -> `'tomorrow'`, else `'in N days'`. */
export function inDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';

  return `in ${days} days`;
}
