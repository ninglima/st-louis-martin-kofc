import type { DuesStatus } from '@kit/dues/types';

import { fraternalYearLabel } from './fraternal-year';
import type {
  FinanceDashboard,
  HostingProvider,
  NetYear,
  StatusCounts,
} from '../types';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const STATUS_ORDER: DuesStatus[] = [
  'current',
  'due_soon',
  'due',
  'lapsed',
  'no_record',
];

const dollars = (cents: number) => cents / 100;

export function collectionRateLabel(
  numerator: number,
  denominator: number,
): string {
  return denominator === 0
    ? '—'
    : `${Math.round((numerator / denominator) * 100)}%`;
}

export function monthLabel(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso;
}

export function toDuesChartData(rows: FinanceDashboard['duesByMonth']) {
  return rows.map((r) => ({
    month: monthLabel(r.month),
    online: dollars(r.onlineCents),
    check: dollars(r.checkCents),
    cash: dollars(r.cashCents),
  }));
}

export function toHostingChartData(
  rows: FinanceDashboard['hostingByMonth'],
  providers: HostingProvider[],
  year: number,
) {
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(year, 6 + i, 1)).toISOString().slice(0, 10);
    const entry: Record<string, string | number> = { month: monthLabel(date) };

    for (const p of providers) {
      const row = rows.find((r) => r.month === date && r.provider === p.slug);
      entry[p.slug] = row ? dollars(row.cents) : 0;
    }

    return entry;
  });
}

export function toStatusChartData(counts: StatusCounts) {
  return STATUS_ORDER.map((status) => ({
    status,
    members: counts[status] ?? 0,
  }));
}

export function toNetChartData(rows: NetYear[], showHosting = true) {
  return rows.map((r) => {
    const year = fraternalYearLabel(r.year);
    const dues = dollars(r.duesCents);

    if (!showHosting) {
      return { year, dues };
    }

    return {
      year,
      dues,
      hosting: dollars(r.hostingCents),
      net: dollars(r.duesCents - r.hostingCents),
    };
  });
}
