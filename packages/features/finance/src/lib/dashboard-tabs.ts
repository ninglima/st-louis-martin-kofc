import type { DashboardTab } from '../types';

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  'overview',
  'collection',
  'lapses',
  'retention',
];

export function parseTab(raw: string | string[] | undefined): DashboardTab {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return (DASHBOARD_TABS as readonly string[]).includes(value ?? '')
    ? (value as DashboardTab)
    : 'overview';
}

/** `?month=` -> the first of a month from this month through eleven months
 * on (matches finance_forecast_members), or null. `today` is the Chicago date. */
export function parseMonthParam(
  raw: string | string[] | undefined,
  today: string,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) {
    return null;
  }

  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const [vy, vm] = value.split('-').map(Number) as [number, number];
  const offset = vy * 12 + vm - (ty * 12 + tm);

  return offset >= 0 && offset <= 11 ? value : null;
}
