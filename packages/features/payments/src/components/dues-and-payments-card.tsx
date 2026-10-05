import Link from 'next/link';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import type {
  CalmBadgeVariant,
  DuesAndPaymentsView,
} from '../lib/dues-and-payments';
import type { PaymentStatus } from '../types/payment.types';

const SECONDARY_BADGE: Record<
  PaymentStatus,
  { label: string; variant: CalmBadgeVariant }
> = {
  pending: { label: 'In progress', variant: 'outline' },
  processing: { label: 'Processing', variant: 'secondary' },
  succeeded: { label: 'Paid', variant: 'default' },
  failed: { label: 'Not completed', variant: 'outline' },
  refunded: { label: 'Refunded', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
};

/**
 * The member home's one card for dues and payments (wording from
 * `describeDuesAndPayments`). Deliberately calm: a brand-coloured edge when
 * something is asked of the member, never red.
 */
export function DuesAndPaymentsCard({ view }: { view: DuesAndPaymentsView }) {
  return (
    <Card
      data-test="dues-payments"
      data-tone={view.tone}
      className={cn(
        'h-full',
        view.tone === 'action' && 'border-l-primary border-l-4',
      )}
    >
      <CardHeader className="flex flex-col gap-y-2">
        <CardTitle>Dues &amp; payments</CardTitle>
        {view.headline ? (
          <div className="flex flex-wrap items-center gap-2">
            {view.badge ? (
              <Badge
                variant={view.badge.variant}
                data-test="dues-payments-badge"
              >
                {view.badge.label}
              </Badge>
            ) : null}
            <p
              className="text-lg font-semibold"
              data-test="dues-payments-headline"
            >
              {view.headline}
            </p>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {view.detail ? (
          <p data-test="dues-payments-detail">{view.detail}</p>
        ) : null}

        {view.note ? (
          <p
            className="text-muted-foreground text-sm"
            data-test="dues-payments-note"
          >
            {view.note}
          </p>
        ) : null}

        {view.action ? (
          <Button
            className="self-start"
            nativeButton={false}
            render={
              <Link href={view.action.href} data-test="dues-payments-action" />
            }
          >
            {view.action.label}
          </Button>
        ) : null}

        {view.secondary.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {view.secondary.map((item) => (
              <li
                key={item.id}
                data-test="dues-payments-secondary"
                className="flex flex-wrap items-center gap-2"
              >
                <Badge
                  variant={SECONDARY_BADGE[item.status].variant}
                  data-status={item.status}
                >
                  {SECONDARY_BADGE[item.status].label}
                </Badge>
                <span>{item.text}</span>
                {item.retry ? (
                  <Link
                    href="/home/checkout"
                    className="text-primary underline-offset-4 hover:underline"
                    data-test="dues-payments-retry"
                  >
                    Try again
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-muted-foreground text-sm">
          <span data-test="dues-payments-year">{view.yearLine}</span>
          {' · '}
          <Link
            href="/home/payments"
            className="text-primary underline-offset-4 hover:underline"
            data-test="dues-payments-history"
          >
            Payment history
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
