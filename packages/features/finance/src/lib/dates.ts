const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(toUtc(iso));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));

  return d.toISOString().slice(0, 10);
}

function wholeMonths(start: string, end: string): number | null {
  if (start.slice(8) !== end.slice(8)) {
    return null;
  }

  const [sy, sm] = start.split('-').map(Number) as [number, number];
  const [ey, em] = end.split('-').map(Number) as [number, number];

  return ey * 12 + em - (sy * 12 + sm);
}

/** Mirrors kit.hosting_next_period: same day of month -> whole months,
 * otherwise the same number of days. */
export function nextPeriod(
  start: string,
  end: string,
): { start: string; end: string } {
  const months = wholeMonths(start, end);

  return months === null
    ? { start: end, end: addDaysIso(end, daysBetween(start, end)) }
    : { start: end, end: addMonthsIso(end, months) };
}

/** What a bill costs per month: a whole-month bill divided by its months,
 * anything else by days (30.4375 days a month). */
export function monthlyEquivalentCents(
  amountCents: number,
  start: string,
  endExclusive: string,
): number {
  const months = wholeMonths(start, endExclusive);

  if (months !== null && months > 0) {
    return Math.round(amountCents / months);
  }

  const days = daysBetween(start, endExclusive);

  return days > 0 ? Math.round((amountCents * 30.4375) / days) : 0;
}
