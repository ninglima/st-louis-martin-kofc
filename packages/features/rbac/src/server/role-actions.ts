'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { RoleSchema } from '../schemas/role.schema';
import { hasPermission } from '../types/permissions';
import { loadPermissionsForUser } from './permissions.service';
import { RolesService } from './roles.service';

async function assertCanManageRoles(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'roles', 'manage')) {
    throw new Error('Unauthorized: roles.manage required');
  }

  return client;
}

export const saveRoleAction = enhanceAction(
  async (data: unknown, user) => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    const client = await assertCanManageRoles(user.id);
    const parsed = RoleSchema.parse(data);
    const service = new RolesService(client);

    if (parsed.id) {
      await service.updateRole(parsed.id, parsed);
    } else {
      await service.createRole(parsed);
    }

    revalidatePath('/home/settings/roles');
    revalidatePath('/home', 'layout');

    return { success: true };
  },
  {},
);

export const deleteRoleAction = enhanceAction(
  async (data: { id: string }, user) => {
    const client = await assertCanManageRoles(user.id);

    await new RolesService(client).deleteRole(data.id);

    revalidatePath('/home/settings/roles');

    return { success: true };
  },
  {},
);
