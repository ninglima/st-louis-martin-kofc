import { fraternalYearLabel } from './fraternal-year';
import { monthLabel } from './chart-data';
import type {
  AgingBucket,
  AgingBucketKey,
  CollectionProgress,
  ForecastMonth,
  Retention,
} from '../types';

const dollars = (cents: number) => cents / 100;

const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const BUCKET_LABELS: Record<AgingBucketKey, string> = {
  '1-30': '1–30 days',
  '31-90': '31–90 days',
  '91-180': '91–180 days',
  '181+': '181+ days',
};

/** `true` when any month has actually collected dues, so the running-total
 * chart can tell "nothing recorded yet" apart from "every month is $0 on
 * the axis." A `null` `cumulativeCents` means the month hasn't happened
 * yet, so it doesn't count as collected either. */
export function hasCollectedDues(rows: CollectionProgress['byMonth']): boolean {
  return rows.some((r) => (r.cumulativeCents ?? 0) > 0);
}

/** "October 2026", for the coming-due drill-down heading. `iso` is a
 * `YYYY-MM-01` month key. */
export function monthYearHeading(iso: string): string {
  const monthIndex = Number(iso.slice(5, 7)) - 1;
  const year = iso.slice(0, 4);

  return `${FULL_MONTHS[monthIndex] ?? iso} ${year}`;
}

export function progressLabel(renewed: number, expected: number): string {
  return expected === 0 ? '—' : `${Math.round((renewed / expected) * 100)}%`;
}

export function toRunningTotalData(
  rows: CollectionProgress['byMonth'],
  expectedCents: number,
) {
  return rows.map((r) => ({
    month: monthLabel(r.month),
    collected: r.cumulativeCents === null ? null : dollars(r.cumulativeCents),
    expected: dollars(expectedCents),
  }));
}

function monthYearLabel(iso: string): string {
  return `${monthLabel(iso)} '${iso.slice(2, 4)}`;
}

export function toForecastChartData(rows: ForecastMonth[]) {
  return rows.map((r) => ({
    key: r.month,
    month: monthYearLabel(r.month),
    members: r.members,
    dollars: dollars(r.cents),
  }));
}

export function toAgingChartData(rows: AgingBucket[]) {
  return rows.map((r) => ({
    bucket: BUCKET_LABELS[r.bucket],
    members: r.members,
    dollars: dollars(r.cents),
  }));
}

export function toRetentionRateData(rows: Retention['years']) {
  return rows.map((r) => ({
    year: fraternalYearLabel(r.year),
    rate: r.eligible === 0 ? null : Math.round((r.renewed / r.eligible) * 100),
    eligible: r.eligible,
    renewed: r.renewed,
  }));
}

export function toLapsesByMonthData(rows: Retention['lapsesByMonth']) {
  return rows.map((r) => ({
    month: monthYearLabel(r.month),
    lapses: r.lapses,
  }));
}
