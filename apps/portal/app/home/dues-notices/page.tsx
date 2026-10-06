import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { NoticeFilters } from '@kit/dues-notices/components/notice-filters';
import { ManualSendPanel } from '@kit/dues-notices/components/manual-send-panel';
import { NoticesTable } from '@kit/dues-notices/components/notices-table';
import { UnreachableList } from '@kit/dues-notices/components/unreachable-list';
import { readNoticesConfig } from '@kit/dues-notices/config';
import { NoticesService } from '@kit/dues-notices/server/notices.service';
import { KIND_LABELS, TRACKING_LABELS } from '@kit/dues-notices/tracking';
import type {
  ManualEligibleMember,
  NoticeKind,
  NoticesMode,
  Tracking,
} from '@kit/dues-notices/types';
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { hasPermission } from '@kit/rbac/types';
import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';

/**
 * Per-user by construction, same reasoning as `hosting-costs/page.tsx`: this
 * segment reads the caller's session and permissions, and the guard below can
 * redirect, so there is no shell worth prerendering ahead of knowing who is
 * asking.
 */
export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MODE_LABELS: Record<NoticesMode, string> = {
  off: 'Off',
  dry_run: 'Dry run (no emails sent)',
  live: 'Live',
};

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Chicago',
});

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toNoticeKind(value: string | undefined): NoticeKind | null {
  return value !== undefined && value in KIND_LABELS
    ? (value as NoticeKind)
    : null;
}

function toTracking(value: string | undefined): Tracking | null {
  return value !== undefined && value in TRACKING_LABELS
    ? (value as Tracking)
    : null;
}

export default function DuesNoticesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <DuesNoticesContent searchParams={searchParams} />
        </Suspense>
      </PageBody>
    </>
  );
}

async function DuesNoticesContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('finance', 'view');

  const perms = await getCurrentPermissions();
  const params = await searchParams;

  const kind = toNoticeKind(firstValue(params.kind));
  const tracking = toTracking(firstValue(params.tracking));

  const service = new NoticesService(getSupabaseServerClient());

  const read = await readDuesIfDeployed(() =>
    Promise.all([
      service.lastRun(),
      service.list({
        kind: kind ?? undefined,
        tracking: tracking ?? undefined,
      }),
      service.unreachable(),
    ]),
  );

  if (!read.deployed) {
    return <p data-test="insights-unavailable">Not available yet.</p>;
  }

  const [lastRun, rows, unreachable] = read.value;
  const config = readNoticesConfig();
  const canOpenMembers = hasPermission(perms, 'members', 'view');
  const canManage = hasPermission(perms, 'finance', 'manage');

  let membersByKind: Record<NoticeKind, ManualEligibleMember[]> | null = null;

  if (canManage) {
    try {
      const kinds = Object.keys(KIND_LABELS) as NoticeKind[];
      const lists = await Promise.all(
        kinds.map((k) => service.manualEligible(k)),
      );
      membersByKind = Object.fromEntries(
        kinds.map((k, i) => [k, lists[i]!]),
      ) as Record<NoticeKind, ManualEligibleMember[]>;
    } catch {
      // Migration not applied yet, or manage permission denied at the RPC.
      membersByKind = null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card data-test="dues-notices-status">
        <CardHeader>
          <CardTitle>Dues notices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-y-2 text-sm">
          <p>Mode: {MODE_LABELS[config.mode]}</p>
          {lastRun ? (
            <p>
              Last run: {dateTimeFmt.format(new Date(lastRun.ranAt))},{' '}
              {lastRun.candidates} due, {lastRun.sent} sent, {lastRun.failed}{' '}
              failed
            </p>
          ) : (
            <p>The daily job has not run yet.</p>
          )}
          {lastRun?.error ? (
            <p className="text-destructive">{lastRun.error}</p>
          ) : null}
        </CardContent>
      </Card>

      {membersByKind ? (
        <ManualSendPanel
          membersByKind={membersByKind}
          allowlistActive={config.allowlist !== null}
          liveReady={
            config.mode === 'live' && config.missingForLive.length === 0
          }
        />
      ) : null}

      <NoticeFilters kind={kind} tracking={tracking} />

      <NoticesTable rows={rows} canOpenMembers={canOpenMembers} />

      <UnreachableList rows={unreachable} canOpenMembers={canOpenMembers} />
    </div>
  );
}
