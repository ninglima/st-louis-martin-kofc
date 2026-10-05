export type CalendarView = 'month' | 'list';

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseMonthParam(
  raw: string | string[] | undefined,
  today: string,
): string {
  const value = first(raw);

  return value && MONTH.test(value) ? value : today.slice(0, 7);
}

export function parseViewParam(
  raw: string | string[] | undefined,
): CalendarView {
  return first(raw) === 'list' ? 'list' : 'month';
}

/**
 * `?type=` reaches `events_in_range` as `p_type_id`, a `uuid` column filter.
 * A malformed value (a stale link, a typo, an empty string) must read as
 * "All types" rather than crash the page with Postgres's 22P02 ("invalid
 * input syntax for type uuid").
 */
export function parseTypeParam(raw: string | string[] | undefined): string {
  const value = first(raw);

  return value && UUID.test(value) ? value : '';
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);

  return new Date(Date.UTC(year!, m! - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);

  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Sunday-first weeks covering `month` (YYYY-MM), padded with the days around it. */
export function monthGrid(month: string, today: string): CalendarDay[][] {
  const firstDay = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const weeks: CalendarDay[][] = [];
  let day = addDays(firstDay, -weekday(firstDay));

  while (day < next) {
    const week: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {
      week.push({
        date: day,
        inMonth: day.startsWith(month),
        isToday: day === today,
      });
      day = addDays(day, 1);
    }

    weeks.push(week);
  }

  return weeks;
}

export function gridRange(weeks: CalendarDay[][]): {
  from: string;
  to: string;
} {
  const days = weeks.flat();

  return { from: days[0]!.date, to: days[days.length - 1]!.date };
}
