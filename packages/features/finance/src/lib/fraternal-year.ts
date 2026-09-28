/** Fraternal year Y runs July 1 of Y to June 30 of Y+1. */
export function fraternalYearOf(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number) as [number, number];

  return month < 7 ? year - 1 : year;
}

/** `?year=` -> a fraternal year between 2000 and next year; anything else is
 * the current year. `today` is the America/Chicago date. */
export function parseYearParam(
  raw: string | string[] | undefined,
  today: string,
): number {
  const current = fraternalYearOf(today);
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !/^\d{4}$/.test(value)) {
    return current;
  }

  const year = Number(value);

  return year >= 2000 && year <= current + 1 ? year : current;
}

export function fraternalYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Newest first, from next year (always offered, since a bill may already
 * cover it -- see `parseYearParam` and the SQL, which accept it too) back to
 * the first year with data. */
export function yearOptions(current: number, firstYear: number): number[] {
  const years: number[] = [];

  for (let y = current + 1; y >= Math.min(firstYear, current); y--) {
    years.push(y);
  }

  return years;
}
