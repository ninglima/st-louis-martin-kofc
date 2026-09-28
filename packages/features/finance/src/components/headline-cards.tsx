import { formatAmountCents } from '@kit/dues/lib/format-amount';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { collectionRateLabel } from '../lib/chart-data';
import type { FinanceDashboard } from '../types';

function Figure({
  hook,
  title,
  value,
  sub,
}: {
  hook: string;
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card data-test={hook}>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sub ? <p className="text-muted-foreground text-xs">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * No client directive: nothing here reads a hook, so it renders server-side
 * (or client-side, embedded in a client tree) without a boundary either way.
 */
export function HeadlineCards({ dashboard }: { dashboard: FinanceDashboard }) {
  const d = dashboard;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        hook="finance-dues-collected"
        title="Dues collected"
        value={formatAmountCents(d.duesCollectedCents)}
        sub="This fraternal year"
      />
      <Figure
        hook="finance-outstanding"
        title="Outstanding"
        value={formatAmountCents(d.outstandingCents)}
        sub="Due and lapsed, as of today"
      />
      <Figure
        hook="finance-collection-rate"
        title="Collection rate"
        value={collectionRateLabel(
          d.collection.numerator,
          d.collection.denominator,
        )}
        sub="Excluding honorary, as of today"
      />
      <Card data-test="finance-hosting-to-date">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-sm font-medium">
            Hosting so far
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">
            {formatAmountCents(d.hostingToDateCents)}
          </div>
          {d.isCurrentYear && d.hostingProjectionCents !== null ? (
            <p
              className="text-muted-foreground text-xs"
              data-test="finance-hosting-projection"
            >
              Projected for the year:{' '}
              {formatAmountCents(d.hostingProjectionCents)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
