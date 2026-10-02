import type { ReactNode } from 'react';

import Link from 'next/link';

import { DuesStatusBadge } from '@kit/dues/components/dues-status-badge';
import {
  type MyDuesTone,
  describeMyDues,
} from '@kit/dues/lib/describe-my-dues';
import { chicagoToday } from '@kit/dues/schemas';
import type { MyDuesSummary } from '@kit/dues/types';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

/** A left edge in the status's weight: loud when dues are owed, the brand
 * colour when they are coming up, nothing when they are paid. */
const EDGE_BY_TONE: Record<MyDuesTone, string> = {
  owed: 'border-l-4 border-l-destructive',
  attention: 'border-l-4 border-l-primary',
  ok: '',
};

/**
 * No client directive: nothing here reads a hook, so this renders on the
 * server. `DuesStatusBadge` and `Button` may themselves be client
 * components -- that's fine, they still mount inside this server tree.
 *
 * `today` is the council's date; tests pin it, the page leaves the default.
 * `paymentsCard` renders directly under the dues card; it is a slot so this
 * package does not depend on `@kit/payments`.
 */
export function MemberHome({
  summary,
  duesDeployed,
  today = chicagoToday(),
  paymentsCard = null,
}: {
  summary: MyDuesSummary | null;
  duesDeployed: boolean;
  today?: string;
  paymentsCard?: ReactNode;
}) {
  const dues = summary ? describeMyDues(summary, today) : null;

  return (
    <div className="flex flex-col gap-4" data-test="member-home">
      {duesDeployed && summary && dues ? (
        <Card
          data-test="member-home-dues"
          data-tone={dues.tone}
          className={EDGE_BY_TONE[dues.tone]}
        >
          <CardHeader className="flex flex-col gap-y-2">
            <CardTitle>My dues</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span data-test="member-home-dues-status">
                <DuesStatusBadge status={summary.duesStatus} />
              </span>
              <p
                className={cn(
                  'text-lg font-semibold',
                  dues.tone === 'owed' && 'text-destructive',
                )}
                data-test="member-home-dues-headline"
              >
                {dues.headline}
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p data-test="member-home-dues-detail">{dues.detail}</p>
            {dues.note ? (
              <p
                className="text-muted-foreground text-sm"
                data-test="member-home-dues-note"
              >
                {dues.note}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {dues.payable ? (
                <Button
                  variant={dues.tone === 'owed' ? 'default' : 'outline'}
                  nativeButton={false}
                  render={
                    <Link
                      href="/home/checkout"
                      data-test="member-home-pay-link"
                    />
                  }
                >
                  Pay dues
                </Button>
              ) : null}
              <Button
                variant="link"
                nativeButton={false}
                render={
                  <Link
                    href="/home/payments"
                    data-test="member-home-dues-history"
                  />
                }
              >
                Payment history
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {paymentsCard}

      {duesDeployed && !summary ? (
        <p className="text-muted-foreground" data-test="member-home-no-member">
          Your sign-in is not linked to a membership record yet. Ask the
          Financial Secretary to link it.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/home/payments" />}
        >
          Payments
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/home/settings" />}
        >
          Settings
        </Button>
      </div>
    </div>
  );
}
