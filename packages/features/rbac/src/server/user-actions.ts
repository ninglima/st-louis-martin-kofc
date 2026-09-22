'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { CreateUserSchema } from '../schemas/user.schema';
import { hasPermission } from '../types/permissions';
import { loadPermissionsForUser } from './permissions.service';
import type { ActionResult } from './role-actions';
import { UsersService } from './users.service';

const UNAUTHORIZED_MESSAGE = 'You do not have permission to manage users.';

async function assertCanManageUsers(userId: string) {
  const client = getSupabaseServerAdminClient();
  const perms = await loadPermissionsForUser(client, userId);

  if (!hasPermission(perms, 'users', 'manage')) {
    return { authorized: false as const };
  }

  return { authorized: true as const, client };
}

export const createUserAction = enhanceAction(
  async (data: unknown, user): Promise<ActionResult> => {
    // Re-checked here because server actions are reachable by direct POST,
    // not only through our UI.
    const auth = await assertCanManageUsers(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    try {
      const parsed = CreateUserSchema.parse(data);
      const service = new UsersService(auth.client);

      if (parsed.mode === 'password') {
        // The Zod refine() guarantees a password in 'password' mode, but it
        // cannot narrow the optional field's type for us -- do that
        // explicitly instead of asserting past it with `!`.
        if (!parsed.password) {
          return {
            success: false,
            error: 'A password of at least 8 characters is required',
          };
        }

        await service.createUserWithPassword(
          parsed.email,
          parsed.password,
          parsed.role_id,
          user.id,
        );
      } else {
        await service.inviteUser(parsed.email, parsed.role_id, user.id);
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to create user.',
      };
    }

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);

export const assignRoleAction = enhanceAction(
  async (
    data: { userId: string; roleId: string },
    user,
  ): Promise<ActionResult> => {
    const auth = await assertCanManageUsers(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    // Prevents self-demotion lockout. The DB trigger is the backstop.
    if (data.userId === user.id) {
      return { success: false, error: 'You cannot change your own role.' };
    }

    try {
      await new UsersService(auth.client).assignRole(
        data.userId,
        data.roleId,
        user.id,
      );
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to assign role.',
      };
    }

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);

export const setUserActiveAction = enhanceAction(
  async (
    data: { userId: string; active: boolean },
    user,
  ): Promise<ActionResult> => {
    const auth = await assertCanManageUsers(user.id);

    if (!auth.authorized) {
      return { success: false, error: UNAUTHORIZED_MESSAGE };
    }

    // Prevents self-lockout. The DB trigger (prevent_admin_ban_lockout) is
    // the backstop for the last-administrator case specifically.
    if (data.userId === user.id) {
      return { success: false, error: 'You cannot deactivate yourself.' };
    }

    try {
      await new UsersService(auth.client).setActive(data.userId, data.active);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update user.',
      };
    }

    revalidatePath('/home/settings/users');

    return { success: true };
  },
  {},
);
