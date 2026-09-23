import { Suspense } from 'react';

import Link from 'next/link';

import { MembersList } from '@kit/members/components/members-list';
import { MembersService } from '@kit/members/server/members.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import { If } from '@kit/ui/if';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '~/components/skeletons/page-skeletons';
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
 * One screen of the roster. `members_list` decrypts every row it returns, and
 * caps `p_limit` at 200 precisely so that one call cannot decrypt the whole
 * table -- so a page asks for a page, and the officer walks the roster rather
 * than the server decrypting 372 addresses to render 50.
 */
const PAGE_SIZE = 50;

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

  // Read as the OFFICER, not the service role: `members_list` is
  // `security definer` and gates on `kit.has_permission(...)`, which reads
  // `auth.uid()` -- and the service-role key carries no `sub`, so under it the
  // function returns nothing at all. See the fuller note in roster-actions.ts.
  const service = new MembersService(getSupabaseServerClient());

  // One more row than the page shows. That extra row is the whole answer to
  // "is there a next page" -- cheaper than a second count query, and it cannot
  // disagree with the rows actually on screen the way a separate count can.
  const rows = await service.list(
    search === '' ? null : search,
    PAGE_SIZE + 1,
    (page - 1) * PAGE_SIZE,
  );

  return (
    <MembersList
      members={rows.slice(0, PAGE_SIZE)}
      search={search}
      page={page}
      pageSize={PAGE_SIZE}
      hasMore={rows.length > PAGE_SIZE}
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
