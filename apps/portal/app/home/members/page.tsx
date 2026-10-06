import { Suspense } from 'react';

import Link from 'next/link';

import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { DuesService } from '@kit/dues/server/dues.service';
import { MembersList } from '@kit/members/components/members-list';
import { parseDuesFilter } from '@kit/members/lib/dues-filter';
import { MembersService } from '@kit/members/server/members.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '@kit/brand/skeletons/page-skeletons';
import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard below can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. The parent
 * layout's `instant = false` does not cover sibling segments -- navigations
 * between /home pages are still validated -- so each one declares its own.
 * See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

/**
 * One screen of the roster, and — since
 * 20260923084500_members_list_page_decrypt.sql — one screen of decryption.
 * That migration moved the filtering, the ordering, the limit and the offset
 * into an inner query over plaintext columns and left only the five
 * `pgp_sym_decrypt` calls in the outer one, so `p_limit` now bounds what gets
 * decrypted and not merely what comes back. `p_limit` is still capped at 200
 * inside the RPC, which is the belt to this brace.
 */
const PAGE_SIZE = 50;

/** The three states of the account filter, as they read in the address bar. */
type AccountFilter = 'all' | 'yes' | 'no';

function parseAccount(value: string): AccountFilter {
  return value === 'yes' || value === 'no' ? value : 'all';
}

type SearchParams = Record<string, string | string[] | undefined>;

export const generateMetadata = async () => {
  return { title: 'Members' };
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';

  return value ?? '';
}

/** 1-based, and never below 1: `?page=0` and `?page=banana` are page one. */
function parsePage(value: string): number {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

async function MembersPage(props: { searchParams: Promise<SearchParams> }) {
  // Checked before the screen exists rather than only inside `members_list`.
  // The RPC gates on the same permission, so an unauthorised caller would get
  // an empty list anyway -- but an empty list reads as "the council has no
  // members", which is a different and much more alarming sentence.
  await requirePermission('members', 'view');

  const permissions = await getCurrentPermissions();
  const canManage = hasPermission(permissions, 'members', 'manage');
  const canManageDues = hasPermission(permissions, 'finance', 'manage');

  return (
    <>
      <PageHeader
        title={'Members'}
        description={'The council roster, as Supreme last exported it'}
      >
        {/*
          The only route to /home/members/import: the sidebar links here, not
          there. Hidden from officers without the grant, which is cosmetic --
          the import page guards itself, and both of its actions re-check on
          every call.
        */}
        <If condition={canManage}>
          <Button
            data-test="members-import-link"
            nativeButton={false}
            render={<Link href={'/home/members/import'} />}
          >
            Import roster
          </Button>
        </If>

        {/*
          Same reasoning as the roster import link above: hidden without
          `finance.manage`, which is cosmetic since the dues-import page and
          its actions all re-check the grant themselves. R15 also requires
          `members.view` on that page, but this button needs no separate
          check for it -- this page itself is reachable only with
          `members.view` (the `requirePermission` call above), so any caller
          who can see this button already holds it.
        */}
        <If condition={canManageDues}>
          <Button
            data-test="members-dues-import-link"
            variant="outline"
            nativeButton={false}
            render={<Link href={'/home/members/dues-import'} />}
          >
            Load paid-through dates
          </Button>
        </If>
      </PageHeader>

      <PageBody>
        <div className="flex w-full flex-1 flex-col">
          <Suspense fallback={<MembersSkeleton />}>
            <MembersContent searchParams={props.searchParams} />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

async function MembersContent(props: { searchParams: Promise<SearchParams> }) {
  const params = await props.searchParams;

  const search = firstValue(params.q);
  const page = parsePage(firstValue(params.page));
  const city = firstValue(params.city);
  const account = parseAccount(firstValue(params.account));

  const currentPermissions = await getCurrentPermissions();

  // The dues columns, the status filter, and the summaries they're built
  // from all sit behind this one grant -- nothing dues-shaped is fetched, let
  // alone sent to the client, for a caller who lacks it.
  const canSeeDues = hasPermission(currentPermissions, 'finance', 'view');
  const duesFilter = canSeeDues
    ? parseDuesFilter(firstValue(params.dues))
    : 'all';

  // Gates the Edit button per row: same grant `member-edit-dialog.tsx` and
  // its server actions re-check before returning or changing anything.
  const canEdit = hasPermission(currentPermissions, 'members', 'manage');
  const canInvite = hasPermission(currentPermissions, 'users', 'manage');

  // Read as the OFFICER, not the service role: `members_list` is
  // `security definer` and gates on `kit.has_permission(...)`, which reads
  // `auth.uid()` -- and the service-role key carries no `sub`, so under it the
  // function returns nothing at all. See the fuller note in roster-actions.ts.
  const client = getSupabaseServerClient();
  const service = new MembersService(client);

  const filters = {
    search: search === '' ? null : search,
    city: city === '' ? null : city,
    hasAccount: account === 'all' ? null : account === 'yes',
  };

  // One more row than the page shows. That extra row is the whole answer to
  // "is there a next page" -- cheaper than a second count query, and it cannot
  // disagree with the rows actually on screen the way a separate count can.
  const [rows, cities] = await Promise.all([
    service.list(filters, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE),
    // Every city on the roster, not just the ones on this page: a filter that
    // can only offer what is already on screen cannot narrow anything.
    service.cities(),
  ]);

  const pageMembers = rows.slice(0, PAGE_SIZE);

  const userIds = pageMembers.flatMap((row) =>
    row.userId === null ? [] : [row.userId],
  );
  // `null` means the confirmation lookup is not deployed yet. Treat every
  // linked login as already signed in so the invite controls stay off those
  // rows until the function exists.
  const confirmed = await service.signInConfirmed(userIds);
  const confirmedUserIds = confirmed ?? new Set(userIds);

  // Same client, same reasoning `DuesService`'s own doc comment gives:
  // `member_dues_summary` is `security definer` and gates on
  // `kit.has_permission('finance', 'view')` against `auth.uid()`, so this
  // must run as the signed-in officer, not the admin client.
  //
  // `readDuesIfDeployed`: before the dues migrations land (they deploy in
  // parallel with the app) a finance viewer gets the plain roster -- no dues
  // columns, no status filter -- exactly as if they lacked the grant.
  const duesRead = canSeeDues
    ? await readDuesIfDeployed(() =>
        new DuesService(client).summaries(pageMembers.map((r) => r.id)),
      )
    : null;
  const dues = duesRead?.deployed ? duesRead.value : undefined;

  return (
    <MembersList
      members={pageMembers}
      search={search}
      city={city}
      account={account}
      cities={cities}
      page={page}
      pageSize={PAGE_SIZE}
      hasMore={rows.length > PAGE_SIZE}
      dues={dues}
      duesFilter={dues ? duesFilter : 'all'}
      canEdit={canEdit}
      canInvite={canInvite}
      confirmedUserIds={confirmedUserIds}
    />
  );
}

function MembersSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-10 w-72 rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </Delayed>
  );
}

export default MembersPage;
