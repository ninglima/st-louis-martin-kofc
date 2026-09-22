'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { RoleSchema } from '../schemas/role.schema';
import { hasPermission } from '../types/permissions';
import { loadPermissionsForUser } from './permissions.service';
import { RolesService } from './roles.service';

/**
 * Next.js redacts thrown Server Action error messages in production builds
 * ("The specific message is omitted in production builds to avoid leaking
 * sensitive details" -- see `next/dist/server/app-render/create-error-handler`).
 * The Postgres trigger and RolesService messages below are the only way an
 * admin learns *why* a save or delete was refused, so they must never cross
 * the action boundary as a thrown error -- only as a return value, which
 * Next.js does not touch.
 */
export type ActionResult =
  | { success: true }
  | { success: false; error: string };

const UNAUTHORIZED_MESSAGE = 'You do not have permission to manage roles.';

async function assertCanManageRoles(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'roles', 'manage')) {
    return { authorized: false as const };
  }

  return { authorized: true as const, client };
}

export const saveRoleAction = enhanceAction(
  async (data: unknown, user): Promise<ActionResult> => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    const auth = await assertCanManageRoles(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    try {
      const parsed = RoleSchema.parse(data);
      const service = new RolesService(auth.client);

      if (parsed.id) {
        await service.updateRole(parsed.id, parsed);
      } else {
        await service.createRole(parsed);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save role.',
      };
    }

    revalidatePath('/home/settings/roles');
    revalidatePath('/home', 'layout');

    return { success: true };
  },
  {},
);

export const deleteRoleAction = enhanceAction(
  async (data: { id: string }, user): Promise<ActionResult> => {
    const auth = await assertCanManageRoles(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    try {
      await new RolesService(auth.client).deleteRole(data.id);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to delete role.',
      };
    }

    revalidatePath('/home/settings/roles');

    return { success: true };
  },
  {},
);
