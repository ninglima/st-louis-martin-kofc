import Link from 'next/link';

import { formatAmountCents } from '@kit/dues/lib/format-amount';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import type { MyPaymentsSummary, MyPaymentsTone } from '../lib/my-payments';
import { PAYMENT_STATUS_VARIANTS } from '../lib/payment-status';
import type { PaymentStatus } from '../types/payment.types';

const LABEL_BY_STATUS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  succeeded: 'Succeeded',
  failed: 'Failed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

/** Same edges as the member home's dues card, so the two read alike. */
const EDGE_BY_TONE: Record<MyPaymentsTone, string> = {
  owed: 'border-l-4 border-l-destructive',
  attention: 'border-l-4 border-l-primary',
  ok: '',
};

function formatMonthDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * The member home's payments card: only the payments that need a word
 * (see `summarizeMyPayments`), then one line for what succeeded this
 * fraternal year. Server-rendered; the dues card above it says whether dues
 * themselves are owed.
 */
export function MyPaymentsCard({ summary }: { summary: MyPaymentsSummary }) {
  const since = formatMonthDay(summary.yearStart);

  return (
    <Card
      data-test="my-payments"
      data-tone={summary.tone}
      className={EDGE_BY_TONE[summary.tone]}
    >
      <CardHeader>
        <CardTitle>My payments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary.attention.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {summary.attention.map((item) => (
              <li
                key={item.id}
                data-test="my-payments-attention"
                className="flex flex-wrap items-center gap-2"
              >
                <Badge
                  variant={PAYMENT_STATUS_VARIANTS[item.status]}
                  data-status={item.status}
                >
                  {LABEL_BY_STATUS[item.status]}
                </Badge>
                <span
                  className={cn(item.status === 'failed' && 'text-destructive')}
                >
                  {item.text}
                </span>
                {item.retry ? (
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        href="/home/checkout"
                        data-test="my-payments-retry"
                      />
                    }
                  >
                    Try again
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <p data-test="my-payments-year">
          {summary.yearCount === 0
            ? 'No payments this year.'
            : `${summary.yearCount} ${summary.yearCount === 1 ? 'payment' : 'payments'} · ${formatAmountCents(summary.yearTotalCents)} since ${since}`}
        </p>

        <div>
          <Button
            variant="link"
            className="px-0"
            nativeButton={false}
            render={
              <Link href="/home/payments" data-test="my-payments-history" />
            }
          >
            Payment history
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
