import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import featuresFlagConfig from '@kit/brand/config/feature-flags';
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { DuesService } from '@kit/dues/server/dues.service';
import {
  DuesByMonthChart,
  HostingByMonthChart,
  NetByYearChart,
  StatusChart,
} from '@kit/finance/components/finance-charts';
import { FollowUpTable } from '@kit/finance/components/follow-up-table';
import { HeadlineCards } from '@kit/finance/components/headline-cards';
import { MemberHome } from '@kit/finance/components/member-home';
import { PaymentsToCheckTable } from '@kit/finance/components/payments-to-check-table';
import { YearPicker } from '@kit/finance/components/year-picker';
import {
  fraternalYearOf,
  parseYearParam,
  yearOptions,
} from '@kit/finance/lib/fraternal-year';
import { FinanceService } from '@kit/finance/server/finance.service';
import type { HostingProvider } from '@kit/finance/types';
import { hasPermission } from '@kit/rbac/types';
import { getCurrentPermissions } from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions to decide between the finance dashboard and the plain member
 * home, so there is no shell worth prerendering ahead of knowing who is
 * asking. See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <HomeContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function HomeContent({ searchParams }: { searchParams: SearchParams }) {
  const perms = await getCurrentPermissions();
  const client = getSupabaseServerClient();

  if (hasPermission(perms, 'finance', 'view')) {
    const today = chicagoToday();
    const year = parseYearParam((await searchParams).year, today);
    const finance = new FinanceService(client);
    const showHosting = featuresFlagConfig.enableHostingCosts;

    const read = await readDuesIfDeployed(() =>
      Promise.all([
        finance.dashboard(year),
        finance.netByYear(),
        finance.followUp(),
        finance.paymentsToCheck(),
        // Hosting providers are only needed to render the hosting-by-month
        // chart, so this read is skipped entirely when the flag is off.
        showHosting
          ? finance.providers()
          : Promise.resolve<HostingProvider[]>([]),
      ]),
    );

    if (read.deployed) {
      const [dashboard, net, followUp, toCheck, providers] = read.value;
      const current = fraternalYearOf(today);

      return (
        <div className="flex flex-col gap-6" data-test="finance-dashboard">
          <YearPicker
            year={year}
            options={yearOptions(current, net[0]?.year ?? current)}
          />
          <HeadlineCards dashboard={dashboard} showHosting={showHosting} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DuesByMonthChart rows={dashboard.duesByMonth} />
            <StatusChart counts={dashboard.statusCounts} />
            {showHosting ? (
              <HostingByMonthChart
                rows={dashboard.hostingByMonth}
                providers={providers}
                year={year}
              />
            ) : null}
            <NetByYearChart rows={net} showHosting={showHosting} />
          </div>
          <FollowUpTable
            rows={followUp}
            canOpenMembers={hasPermission(perms, 'members', 'view')}
          />
          <PaymentsToCheckTable rows={toCheck} />
        </div>
      );
    }
  }

  const dues = await readDuesIfDeployed(() =>
    new DuesService(client).mySummary(),
  );

  return (
    <MemberHome
      summary={dues.deployed ? dues.value : null}
      duesDeployed={dues.deployed}
    />
  );
}
