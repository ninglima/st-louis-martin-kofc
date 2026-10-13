import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { ReportsScreen } from '@kit/finance/components/reports-screen';
import {
  defaultWorksheetMonth,
  worksheetMonthOptions,
} from '@kit/finance/lib/worksheet-month';
import { FinanceService } from '@kit/finance/server/finance.service';
import {
  readReportMailConfig,
  reportEmailBlocker,
} from '@kit/finance/server/report-mail';
import { requirePermission } from '~/lib/server/require-permission';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

/**
 * Per-user by construction: the guard below redirects when the caller
 * lacks the finance dashboard, so there is no shell worth prerendering
 * ahead of knowing who is asking. See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

export const generateMetadata = async () => ({ title: 'Reports' });

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function searchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <ReportsContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function ReportsContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('dashboard_finance', 'view');

  const params = await searchParams;
  const today = chicagoToday();
  const monthOptions = worksheetMonthOptions(today);
  const requestedMonth = searchParam(params.month);
  const month =
    requestedMonth && monthOptions.includes(requestedMonth)
      ? requestedMonth
      : defaultWorksheetMonth(today);

  const finance = new FinanceService(getSupabaseServerClient());
  const read = await readDuesIfDeployed(() =>
    Promise.all([finance.monthlyWorksheet(month), finance.paymentPackets()]),
  );

  if (!read.deployed) {
    return <p className="text-muted-foreground">Not available yet.</p>;
  }

  const [worksheet, packets] = read.value;
  const user = await requireUserInServerComponent();
  const emailBlocker = reportEmailBlocker(
    readReportMailConfig(),
    user.email ?? null,
  );
  const editing =
    packets.find((packet) => packet.id === searchParam(params.packet)) ?? null;

  return (
    <ReportsScreen
      worksheet={worksheet}
      packets={packets}
      month={month}
      monthOptions={monthOptions}
      emailBlocker={emailBlocker}
      editing={editing}
    />
  );
}
