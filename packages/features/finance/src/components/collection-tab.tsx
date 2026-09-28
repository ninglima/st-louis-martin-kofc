import Link from 'next/link';

import { formatAmountCents } from '@kit/dues/lib/format-amount';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { progressLabel } from '../lib/insights-data';
import type {
  CollectionProgress,
  ForecastMember,
  ForecastMonth,
} from '../types';
import { ForecastChart, RunningTotalChart } from './insights-charts';

export function CollectionSummary({
  progress,
}: {
  progress: CollectionProgress;
}) {
  const percent =
    progress.expected === 0
      ? 0
      : Math.round((progress.renewed / progress.expected) * 100);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card data-test="collection-progress">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            Renewals received
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="text-2xl font-semibold">
            {progressLabel(progress.renewed, progress.expected)}
          </div>
          <Progress value={percent} aria-label="Renewals received" />
          <p className="text-muted-foreground text-xs">
            {progress.renewed} of {progress.expected} expected, excluding
            honorary
          </p>
        </CardContent>
      </Card>
      <Card data-test="collection-collected">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            Dues collected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">
            {formatAmountCents(progress.collectedCents)}
          </div>
        </CardContent>
      </Card>
      <Card data-test="collection-expected">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            Dues expected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">
            {formatAmountCents(progress.expectedCents)}
          </div>
          <p className="text-muted-foreground text-xs">
            At each expected member's current level
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function CollectionTab({
  progress,
  forecast,
  month,
  monthMembers,
  canOpenMembers,
}: {
  progress: CollectionProgress;
  forecast: ForecastMonth[];
  month: string | null;
  monthMembers: ForecastMember[];
  canOpenMembers: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <CollectionSummary progress={progress} />
      <RunningTotalChart
        rows={progress.byMonth}
        expectedCents={progress.expectedCents}
      />
      <ForecastChart rows={forecast} selected={month} />
      {month ? (
        <Card data-test="collection-forecast-members">
          <CardHeader>
            <CardTitle>Coming due in {month.slice(0, 7)}</CardTitle>
          </CardHeader>
          <CardContent>
            {monthMembers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody is due that month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Membership #</TableHead>
                    <TableHead>Paid through</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthMembers.map((m) => (
                    <TableRow
                      key={m.memberId}
                      data-test="collection-forecast-row"
                    >
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
                      <TableCell>{m.paidThrough ?? '—'}</TableCell>
                      <TableCell>{m.levelName}</TableCell>
                      <TableCell>{formatAmountCents(m.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
