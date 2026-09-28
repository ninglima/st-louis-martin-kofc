import { notFound } from 'next/navigation';

import { MemberDuesCard } from '@kit/dues/components/member-dues-card';
import { DuesService } from '@kit/dues/server/dues.service';
import { MembersService } from '@kit/members/server/members.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import { badgeExtras } from '@kit/ui/badge-extras';
import { If } from '@kit/ui/if';
import { PageBody, PageHeader } from '@kit/ui/page';

import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';

/**
 * Per-user by construction, same reasoning as `/home/members`: this segment
 * reads the caller's permissions and the member itself, so there is no shell
 * worth prerendering ahead of knowing who is asking and which member they
 * asked for.
 */
export const instant = false;

export const generateMetadata = async () => {
  return { title: 'Member' };
};

async function MemberDetailPage(props: { params: Promise<{ id: string }> }) {
  // Checked before the screen exists rather than only inside `getMember` /
  // `members_select_own`: an unauthorised caller reading their own row would
  // still get data back (the RLS policy also allows `user_id = auth.uid()`),
  // which is the wrong screen for an officer who followed a stale link.
  await requirePermission('members', 'view');

  const { id } = await props.params;
  const permissions = await getCurrentPermissions();

  const membersService = new MembersService(getSupabaseServerClient());
  const member = await membersService.getMember(id);

  if (!member) {
    notFound();
  }

  const canViewFinance = hasPermission(permissions, 'finance', 'view');

  const dues = canViewFinance
    ? await loadDues(id, hasPermission(permissions, 'finance', 'manage'))
    : null;

  return (
    <>
      <PageHeader
        title={member.fullName}
        description={`Member #${member.membershipNumber}`}
      />

      <PageBody>
        <div className="flex w-full flex-col gap-y-6">
          <div
            className="flex flex-col gap-y-2 rounded-lg border p-4"
            data-test="member-roster-details"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{member.fullName}</span>

              <If condition={member.badAddress}>
                <Badge
                  variant="outline"
                  className={badgeExtras.warning}
                  data-test="member-bad-address"
                >
                  Bad address
                </Badge>
              </If>

              <If
                condition={member.userId !== null}
                fallback={
                  <Badge variant="outline" data-test="member-no-account">
                    No account
                  </Badge>
                }
              >
                <Badge
                  variant="outline"
                  className={badgeExtras.success}
                  data-test="member-has-account"
                >
                  Has sign-in
                </Badge>
              </If>
            </div>

            <dl className="text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline font-medium">Member #: </dt>
                <dd className="inline">{member.membershipNumber}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Email: </dt>
                <dd className="inline">{member.primaryEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="inline font-medium">City: </dt>
                <dd className="inline">
                  {[member.city, member.state]
                    .filter((part): part is string => Boolean(part))
                    .join(', ') || '—'}
                </dd>
              </div>
            </dl>
          </div>

          <If condition={dues}>
            {(loaded) => (
              <MemberDuesCard
                summary={loaded.summary}
                ledger={loaded.ledger}
                levels={loaded.levels}
                canManage={loaded.canManage}
                memberId={id}
              />
            )}
          </If>
        </div>
      </PageBody>
    </>
  );
}

async function loadDues(memberId: string, canManage: boolean) {
  // Read as the officer, not the service role: every one of these RPCs is
  // `security definer` and gates on `kit.has_permission('finance', 'view')`
  // internally, which reads `auth.uid()` -- see `DuesService`'s own doc
  // comment for the fuller reasoning (`members.service.ts` documents the
  // same thing for the roster read above).
  const duesService = new DuesService(getSupabaseServerClient());

  const [summaries, ledger, levels] = await Promise.all([
    duesService.summaries([memberId]),
    duesService.ledger(memberId),
    duesService.levels(),
  ]);

  const summary = summaries.get(memberId);

  // `member_dues_summary` returns one row per id it was asked about and the
  // caller already holds `finance.view` at this point (that is the only way
  // `loadDues` gets called) -- so a missing row here would mean the member
  // itself disappeared between the two reads, not a permission gap. Treated
  // as "no dues card" rather than a thrown error: the roster half of the
  // page is still worth showing.
  if (!summary) {
    return null;
  }

  return { summary, ledger, levels, canManage };
}

export default MemberDetailPage;
