import { Suspense } from 'react';

import { RolesManager } from '@kit/rbac/components/roles-manager';
import { RolesService } from '@kit/rbac/server/roles.service';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '~/components/skeletons/page-skeletons';
import { getCurrentPermissions } from '~/lib/server/require-permission';

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
  const adminClient = getSupabaseServerAdminClient();
  const service = new RolesService(adminClient);

  const [roles, permissions] = await Promise.all([
    service.listRoles(),
    getCurrentPermissions(),
  ]);

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
