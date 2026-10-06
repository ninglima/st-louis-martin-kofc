import Link from 'next/link';

import { DuesStatusBadge } from '@kit/dues/components/dues-status-badge';
import { formatAmountCents } from '@kit/dues/lib/format-amount';

import { LastNoticeCell } from '@kit/dues-notices/components/last-notice-cell';
import type { LastNotice } from '@kit/dues-notices/types';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import type { FollowUpRow } from '../types';

export function FollowUpTable({
  rows,
  canOpenMembers,
  lapsedCount = 0,
  lastNotices,
}: {
  rows: FollowUpRow[];
  canOpenMembers: boolean;
  /** `dashboard.statusCounts.lapsed`: lapsed members live on the Lapses tab,
   * not here, so this points there instead of implying nobody owes anything
   * (I2). */
  lapsedCount?: number;
  /** Left out entirely -- no "Last notice" column -- when this prop is
   * omitted, so existing callers and tests are unchanged. */
  lastNotices?: Record<string, LastNotice>;
}) {
  return (
    <Card data-test="finance-follow-up">
      <CardHeader>
        <CardTitle>Follow up (as of today)</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody is due in the next 30 days.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Membership #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid through</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Owed</TableHead>
                  {lastNotices ? <TableHead>Last notice</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const name = `${row.firstName} ${row.lastName}`;

                  return (
                    <TableRow
                      key={row.memberId}
                      data-test="finance-follow-up-row"
                    >
                      <TableCell>
                        {canOpenMembers ? (
                          <Link href={`/home/members/${row.memberId}`}>
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </TableCell>
                      <TableCell>{row.membershipNumber}</TableCell>
                      <TableCell>
                        <DuesStatusBadge status={row.duesStatus} />
                      </TableCell>
                      <TableCell>{row.paidThrough ?? '—'}</TableCell>
                      <TableCell>{row.levelName}</TableCell>
                      <TableCell>
                        {formatAmountCents(row.amountCents)}
                      </TableCell>
                      {lastNotices ? (
                        <TableCell>
                          <LastNoticeCell notice={lastNotices[row.memberId]} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {lapsedCount > 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {lapsedCount} lapsed member{lapsedCount === 1 ? '' : 's'} —{' '}
            <Link
              href="/home/dashboard?tab=lapses"
              className="underline underline-offset-2"
              data-test="follow-up-lapsed-link"
            >
              see Lapses
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
