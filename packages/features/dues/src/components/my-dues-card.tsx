import Link from 'next/link';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { If } from '@kit/ui/if';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import { formatAmountCents } from '../lib/format-amount';
import type { MyDuesSummary, MyLedgerRow } from '../types';
import { DuesStatusBadge } from './dues-status-badge';

const METHOD_LABELS: Record<MyLedgerRow['method'], string> = {
  check: 'Check',
  cash: 'Cash',
  waived: 'Waived',
  online: 'Online',
  opening_balance: 'Opening balance',
};

/** The three statuses a checkout would actually move forward -- `current`
 * and `no_record` (no assigned level to check out on) get no offer. */
const PAYABLE_STATUSES = new Set<MyDuesSummary['duesStatus']>([
  'due',
  'lapsed',
  'due_soon',
]);

/**
 * The signed-in member's own dues card on `/home/payments`: their standing,
 * their level, and their own ledger -- read-only throughout, unlike
 * `MemberDuesCard`, since a member manages nothing about their own dues here
 * beyond paying them. `ledger` is `MyLedgerRow[]`, deliberately narrower than
 * `DuesLedgerRow` (no check number, void reason, or recorded-by -- see R14
 * and the doc comment on `MyLedgerRow`), so a voided row renders struck
 * through with nothing more said about it.
 */
export function MyDuesCard({
  summary,
  ledger,
}: {
  summary: MyDuesSummary;
  ledger: MyLedgerRow[];
}) {
  return (
    <Card data-test="my-dues">
      <CardHeader className="flex flex-col gap-y-3">
        <CardTitle>My dues</CardTitle>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span data-test="my-dues-status">
            <DuesStatusBadge status={summary.duesStatus} />
          </span>

          <span data-test="my-dues-paid-through" className="text-sm">
            {summary.paidThrough
              ? `Paid through ${summary.paidThrough}`
              : 'No dues recorded yet'}
          </span>

          <span className="text-sm">
            {summary.levelName} — {formatAmountCents(summary.amountCents)}
          </span>

          <If condition={PAYABLE_STATUSES.has(summary.duesStatus)}>
            <Button
              data-test="my-dues-pay-link"
              nativeButton={false}
              render={<Link href="/home/checkout" />}
            >
              Pay dues
            </Button>
          </If>
        </div>
      </CardHeader>

      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Covers</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              <If condition={ledger.length === 0}>
                <TableRow data-test="my-dues-ledger-empty">
                  <TableCell colSpan={3} className="text-muted-foreground">
                    No dues recorded yet.
                  </TableCell>
                </TableRow>
              </If>

              {ledger.map((row) => {
                const voided = row.voided_at !== null;

                return (
                  <TableRow key={row.id} data-test="my-dues-ledger-row">
                    <TableCell className={cn(voided && 'line-through')}>
                      {row.period_start} → {row.period_end}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {METHOD_LABELS[row.method]}
                    </TableCell>
                    <TableCell className={cn(voided && 'line-through')}>
                      {formatAmountCents(row.amount_cents)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
