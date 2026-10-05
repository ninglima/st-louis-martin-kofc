import { Suspense } from 'react';

import { redirect } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import featuresFlagConfig from '@kit/brand/config/feature-flags';
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { chicagoToday } from '@kit/dues/schemas';
import { HostingCostsTable } from '@kit/finance/components/hosting-costs-table';
import { YearPicker } from '@kit/finance/components/year-picker';
import {
  fraternalYearOf,
  parseYearParam,
  yearOptions,
} from '@kit/finance/lib/fraternal-year';
import { FinanceService } from '@kit/finance/server/finance.service';
import { hasPermission } from '@kit/rbac/types';
import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard below can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. See the fuller
 * note in app/home/layout.tsx.
 */
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function HostingCostsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!featuresFlagConfig.enableHostingCosts) {
    redirect('/home');
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <HostingCostsContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function HostingCostsContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('finance', 'view');

  const perms = await getCurrentPermissions();
  const today = chicagoToday();
  const year = parseYearParam((await searchParams).year, today);
  const service = new FinanceService(getSupabaseServerClient());

  const read = await readDuesIfDeployed(() =>
    Promise.all([
      service.providers(),
      service.listCosts(year),
      service.latestBills(),
      service.netByYear(),
    ]),
  );

  if (!read.deployed) {
    return (
      <p data-test="hosting-costs-empty">
        Hosting costs are not available yet.
      </p>
    );
  }

  const [providers, costs, latest, net] = read.value;
  const current = fraternalYearOf(today);

  return (
    <div className="flex flex-col gap-4">
      <YearPicker
        year={year}
        options={yearOptions(current, net[0]?.year ?? current)}
      />
      <HostingCostsTable
        costs={costs}
        providers={providers}
        latest={latest}
        canManage={hasPermission(perms, 'finance', 'manage')}
      />
    </div>
  );
}
