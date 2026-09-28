import Link from 'next/link';

import { DuesStatusBadge } from '@kit/dues/components/dues-status-badge';
import { formatAmountCents } from '@kit/dues/lib/format-amount';

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
}: {
  rows: FollowUpRow[];
  canOpenMembers: boolean;
}) {
  return (
    <Card data-test="finance-follow-up">
      <CardHeader>
        <CardTitle>Follow up (as of today)</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Everyone is paid up.</p>
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
