import type { ReportMemberRow } from '../types';

const FORMULA_STARTERS = /^[=@]/;

function escapeCsv(value: string): string {
  const defused = FORMULA_STARTERS.test(value) ? `'${value}` : value;

  return /[",\r\n]/.test(defused)
    ? `"${defused.replaceAll('"', '""')}"`
    : defused;
}

export function reportCsv(rows: ReportMemberRow[]): string {
  return [
    'Member,Membership Number,Events,Hours',
    ...rows.map((r) =>
      [r.name, r.membershipNumber, String(r.events), String(r.hours)]
        .map(escapeCsv)
        .join(','),
    ),
  ].join('\r\n');
}
