import Link from 'next/link';

import { DuesStatusBadge } from '@kit/dues/components/dues-status-badge';
import type { MyDuesSummary } from '@kit/dues/types';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

const PAYABLE = new Set(['due', 'lapsed', 'due_soon']);

/**
 * No client directive: nothing here reads a hook, so this renders on the
 * server. `DuesStatusBadge` and `Button` may themselves be client
 * components -- that's fine, they still mount inside this server tree.
 */
export function MemberHome({
  summary,
  duesDeployed,
}: {
  summary: MyDuesSummary | null;
  duesDeployed: boolean;
}) {
  return (
    <div className="flex flex-col gap-4" data-test="member-home">
      {duesDeployed && summary ? (
        <Card>
          <CardHeader>
            <CardTitle>My dues</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span data-test="member-home-dues-status">
              <DuesStatusBadge status={summary.duesStatus} />
            </span>
            <p>Paid through {summary.paidThrough ?? '—'}</p>
            <p>Level: {summary.levelName}</p>
            {PAYABLE.has(summary.duesStatus) ? (
              <Button
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
          </CardContent>
        </Card>
      ) : null}

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
