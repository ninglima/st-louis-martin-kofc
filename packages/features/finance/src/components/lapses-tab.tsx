import Link from 'next/link';

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

import { BUCKET_LABELS } from '../lib/insights-data';
import type { AgingBucket, LapsedMember } from '../types';
import { AgingChart } from './insights-charts';

export function LapsesTab({
  buckets,
  members,
  canOpenMembers,
}: {
  buckets: AgingBucket[];
  members: LapsedMember[];
  canOpenMembers: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p
        className="text-muted-foreground text-sm"
        data-test="lapses-explanation"
      >
        Lapsed here means unpaid today, from day 1.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((b) => (
          <Card key={b.bucket} data-test={`lapses-bucket-${b.bucket}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {BUCKET_LABELS[b.bucket]} unpaid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{b.members}</div>
              <p className="text-muted-foreground text-xs">
                {formatAmountCents(b.cents)} owed
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <AgingChart buckets={buckets} />
      <Card data-test="lapsed-members">
        <CardHeader>
          <CardTitle>Lapsed and unpaid members (as of today)</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No lapsed members.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Membership #</TableHead>
                  <TableHead>Days unpaid</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Owed</TableHead>
                  <TableHead>Last paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.memberId} data-test="lapsed-member-row">
                    <TableCell>
                      {canOpenMembers ? (
                        <Link
                          href={`/home/members/${m.memberId}`}
                        >{`${m.firstName} ${m.lastName}`}</Link>
                      ) : (
                        `${m.firstName} ${m.lastName}`
                      )}
                    </TableCell>
                    <TableCell>{m.membershipNumber}</TableCell>
                    <TableCell>
                      {m.daysUnpaid} ({BUCKET_LABELS[m.bucket]})
                    </TableCell>
                    <TableCell>{m.levelName}</TableCell>
                    <TableCell>{formatAmountCents(m.amountCents)}</TableCell>
                    <TableCell>{m.lastPaidOn ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
