'use client';

import { Button } from '@kit/ui/button';

import { reportCsv } from '../lib/report-csv';
import type { ReportMemberRow } from '../types';

export function ExportReportButton({
  rows,
  year,
}: {
  rows: ReportMemberRow[];
  year: number;
}) {
  return (
    <Button
      variant="outline"
      data-test="report-export"
      disabled={rows.length === 0}
      onClick={() => {
        const blob = new Blob([reportCsv(rows)], {
          type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `volunteer-hours-${year}-${year + 1}.csv`;
        link.click();
        // Deferred so the click's download navigation has already picked up
        // the blob URL before it is revoked.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}
    >
      Export CSV
    </Button>
  );
}
