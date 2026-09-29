import { Suspense } from 'react';

import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import featuresFlagConfig from '@kit/brand/config/feature-flags';
import { NoticesService } from '@kit/dues-notices/server/notices.service';
import type { LastNotice } from '@kit/dues-notices/types';
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { DuesService } from '@kit/dues/server/dues.service';
import { CollectionTab } from '@kit/finance/components/collection-tab';
import { DashboardTabsNav } from '@kit/finance/components/dashboard-tabs-nav';
import {
  DuesByMonthChart,
  HostingByMonthChart,
  NetByYearChart,
  StatusChart,
} from '@kit/finance/components/finance-charts';
import { FollowUpTable } from '@kit/finance/components/follow-up-table';
import { HeadlineCards } from '@kit/finance/components/headline-cards';
import { LapsesTab } from '@kit/finance/components/lapses-tab';
import { MemberHome } from '@kit/finance/components/member-home';
import { PaymentsToCheckTable } from '@kit/finance/components/payments-to-check-table';
import { RetentionTab } from '@kit/finance/components/retention-tab';
import { YearPicker } from '@kit/finance/components/year-picker';
import { parseMonthParam, parseTab } from '@kit/finance/lib/dashboard-tabs';
import { isForecastMonthOutOfRangeError } from '@kit/finance/lib/forecast-month-error';
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
// `ReturnType<typeof getSupabaseServerClient>` alone loses the `Database`
// generic -- utility types don't apply a generic function's default type
// argument, only an explicit call does -- so it's pinned here instead.
type SupabaseServerClient = ReturnType<
  typeof getSupabaseServerClient<Database>
>;

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
    const params = await searchParams;
    const today = chicagoToday();
    const tab = parseTab(params.tab);
    const finance = new FinanceService(client);
    const canOpenMembers = hasPermission(perms, 'members', 'view');

    return (
      <div className="flex flex-col gap-6" data-test="finance-dashboard">
        <DashboardTabsNav active={tab} />
        {tab === 'overview' ? (
          <OverviewTab
            client={client}
            finance={finance}
            today={today}
            canOpenMembers={canOpenMembers}
          />
        ) : null}
        {tab === 'collection' ? (
          <CollectionTabContent
            finance={finance}
            today={today}
            year={parseYearParam(params.year, today)}
            month={parseMonthParam(params.month, today)}
            canOpenMembers={canOpenMembers}
          />
        ) : null}
        {tab === 'lapses' ? (
          <LapsesTabContent
            client={client}
            finance={finance}
            canOpenMembers={canOpenMembers}
          />
        ) : null}
        {tab === 'retention' ? <RetentionTabContent finance={finance} /> : null}
      </div>
    );
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

/**
 * Today's dashboard, unchanged: the headline cards, the dues-per-month,
 * status, per-year and hosting charts, the follow-up list and payments to
 * check. Always reads the current fraternal year -- the Collection tab is
 * where a different year is picked. Falls back to the member home when dues
 * aren't deployed, exactly as the pre-tabs page did.
 */
async function OverviewTab({
  client,
  finance,
  today,
  canOpenMembers,
}: {
  client: SupabaseServerClient;
  finance: FinanceService;
  today: string;
  canOpenMembers: boolean;
}) {
  const current = fraternalYearOf(today);
  const showHosting = featuresFlagConfig.enableHostingCosts;

  const read = await readDuesIfDeployed(() =>
    Promise.all([
      finance.dashboard(current),
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

  if (!read.deployed) {
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

  const [dashboard, net, followUp, toCheck, providers] = read.value;

  const lastNoticesRead = await readDuesIfDeployed(() =>
    new NoticesService(client).lastNotices(followUp.map((r) => r.memberId)),
  );
  const lastNotices: Record<string, LastNotice> = lastNoticesRead.deployed
    ? lastNoticesRead.value
    : {};

  return (
    <>
      <HeadlineCards dashboard={dashboard} showHosting={showHosting} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DuesByMonthChart rows={dashboard.duesByMonth} />
        <StatusChart counts={dashboard.statusCounts} />
        {showHosting ? (
          <HostingByMonthChart
            rows={dashboard.hostingByMonth}
            providers={providers}
            year={current}
          />
        ) : null}
        <NetByYearChart rows={net} showHosting={showHosting} />
      </div>
      <FollowUpTable
        rows={followUp}
        canOpenMembers={canOpenMembers}
        lapsedCount={dashboard.statusCounts.lapsed}
        lastNotices={lastNotices}
      />
      <PaymentsToCheckTable rows={toCheck} />
    </>
  );
}

async function CollectionTabContent({
  finance,
  today,
  year,
  month,
  canOpenMembers,
}: {
  finance: FinanceService;
  today: string;
  year: number;
  month: string | null;
  canOpenMembers: boolean;
}) {
  const current = fraternalYearOf(today);

  // A forecast month can pass parseMonthParam's check (against this
  // process's "today") and still be out of range by the time the RPC runs
  // against kit.council_today() -- a request straddling midnight on the
  // first of a month. Treat that race as no month selected, with an empty
  // drill-down, instead of sending the page to the error boundary (M4).
  // Any other error from forecastMembers is a real failure and still throws.
  let monthOutOfRange = false;

  const read = await readDuesIfDeployed(() =>
    Promise.all([
      finance.collectionProgress(year),
      finance.renewalsForecast(),
      finance.netByYear(),
      month
        ? finance.forecastMembers(month).catch((error: unknown) => {
            if (!isForecastMonthOutOfRangeError(error)) {
              throw error;
            }

            monthOutOfRange = true;

            return [];
          })
        : Promise.resolve([]),
    ]),
  );

  if (!read.deployed) {
    return (
      <p className="text-muted-foreground" data-test="insights-unavailable">
        Not available yet.
      </p>
    );
  }

  const [progress, forecast, net, monthMembers] = read.value;
  const effectiveMonth = monthOutOfRange ? null : month;

  return (
    <>
      <YearPicker
        year={year}
        options={yearOptions(current, net[0]?.year ?? current)}
      />
      <CollectionTab
        progress={progress}
        forecast={forecast}
        month={effectiveMonth}
        monthMembers={monthMembers}
        canOpenMembers={canOpenMembers}
      />
    </>
  );
}

async function LapsesTabContent({
  client,
  finance,
  canOpenMembers,
}: {
  client: SupabaseServerClient;
  finance: FinanceService;
  canOpenMembers: boolean;
}) {
  const read = await readDuesIfDeployed(() =>
    Promise.all([finance.lapseAging(), finance.lapsedMembers()]),
  );

  if (!read.deployed) {
    return (
      <p className="text-muted-foreground" data-test="insights-unavailable">
        Not available yet.
      </p>
    );
  }

  const [buckets, members] = read.value;

  const lastNoticesRead = await readDuesIfDeployed(() =>
    new NoticesService(client).lastNotices(members.map((m) => m.memberId)),
  );
  const lastNotices: Record<string, LastNotice> = lastNoticesRead.deployed
    ? lastNoticesRead.value
    : {};

  return (
    <LapsesTab
      buckets={buckets}
      members={members}
      canOpenMembers={canOpenMembers}
      lastNotices={lastNotices}
    />
  );
}

async function RetentionTabContent({ finance }: { finance: FinanceService }) {
  const read = await readDuesIfDeployed(() => finance.retention());

  if (!read.deployed) {
    return (
      <p className="text-muted-foreground" data-test="insights-unavailable">
        Not available yet.
      </p>
    );
  }

  return <RetentionTab retention={read.value} />;
}
