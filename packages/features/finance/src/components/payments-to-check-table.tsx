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

import type { PaymentToCheck } from '../types';

/**
 * These are online dues payments that succeeded but recorded no dues
 * period, so nothing in `finance_dashboard` or `finance_follow_up` reflects
 * them yet -- the Financial Secretary has to record each one by hand on the
 * member's page. Returns `null` (not an empty state) when there is nothing
 * to check, so the section disappears entirely once the queue is clear.
 */
export function PaymentsToCheckTable({ rows }: { rows: PaymentToCheck[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card data-test="finance-payments-to-check">
      <CardHeader>
        <CardTitle>Payments to check</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          These online dues payments succeeded, but no dues period was recorded
          for them. Record each one on the member&apos;s page.
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Provider</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.paymentId}>
                  <TableCell>{row.createdAt.slice(0, 10)}</TableCell>
                  <TableCell>
                    {row.memberId ? (
                      <Link href={`/home/members/${row.memberId}`}>
                        {row.memberName ?? 'No linked member'}
                      </Link>
                    ) : (
                      (row.memberName ?? 'No linked member')
                    )}
                  </TableCell>
                  <TableCell>{row.duesLevel ?? '—'}</TableCell>
                  <TableCell>{formatAmountCents(row.amountCents)}</TableCell>
                  <TableCell>{row.provider}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
