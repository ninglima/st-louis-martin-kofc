import { Suspense } from 'react';

import { RolesManager } from '@kit/rbac/components/roles-manager';
import { RolesService } from '@kit/rbac/server/roles.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '@kit/brand/skeletons/page-skeletons';
import { getCurrentPermissions } from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. The parent
 * layout's `instant = false` does not cover sibling segments -- navigations
 * between /home pages are still validated -- so each one declares its own.
 * See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

export const generateMetadata = async () => {
  return { title: 'Roles' };
};

function RolesPage() {
  return (
    <PageBody>
      <div className="flex w-full flex-1 flex-col">
        <Suspense fallback={<RolesSkeleton />}>
          <RolesContent />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function RolesContent() {
  // getCurrentPermissions() reaches `connection()` (via
  // requireUserInServerComponent) before touching anything else, and
  // `connection()` never resolves during prerendering -- that is what marks
  // this segment dynamic under Cache Components. It has to be awaited
  // *before* getSupabaseServerAdminClient() runs: constructing the admin
  // client first (or racing the two in Promise.all, as this used to) lets
  // Next actually execute it during `next build`, where
  // SUPABASE_SERVICE_ROLE_KEY is deliberately absent (it is a runtime-only
  // secret, injected via Cloud Run), so the build fails instead of deferring
  // this segment to request time.
  const permissions = await getCurrentPermissions();
  const adminClient = getSupabaseServerAdminClient();
  const service = new RolesService(adminClient);
  const roles = await service.listRoles();

  const canManage = hasPermission(permissions, 'roles', 'manage');

  return <RolesManager roles={roles} canManage={canManage} />;
}

function RolesSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </Delayed>
  );
}

export default RolesPage;
