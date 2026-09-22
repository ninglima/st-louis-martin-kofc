import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { RolesService } from '@kit/rbac/server/roles.service';
import { UsersService } from '@kit/rbac/server/users.service';
import { hasPermission } from '@kit/rbac/types';
import { UsersManager } from '@kit/rbac/components/users-manager';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '~/components/skeletons/page-skeletons';
import { getCurrentPermissions } from '~/lib/server/require-permission';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

export const generateMetadata = async () => {
  const t = await getTranslations();

  return { title: t('rbac.users.title') };
};

function UsersPage() {
  return (
    <PageBody>
      <div className="flex w-full flex-1 flex-col">
        <Suspense fallback={<UsersSkeleton />}>
          <UsersContent />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function UsersContent() {
  const adminClient = getSupabaseServerAdminClient();
  const usersService = new UsersService(adminClient);
  const rolesService = new RolesService(adminClient);

  const [currentUser, users, roles, permissions] = await Promise.all([
    requireUserInServerComponent(),
    usersService.listUsers(),
    rolesService.listRoles(),
    getCurrentPermissions(),
  ]);

  const canManage = hasPermission(permissions, 'users', 'manage');

  return (
    <UsersManager
      users={users}
      roles={roles.map((role) => ({ id: role.id, name: role.name }))}
      canManage={canManage}
      currentUserId={currentUser.id}
    />
  );
}

function UsersSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </Delayed>
  );
}

export default UsersPage;
