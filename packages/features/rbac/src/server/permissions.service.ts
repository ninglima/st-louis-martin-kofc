import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { PermissionMap } from '../types/permissions';

type RbacClient = SupabaseClient<Database>;

/**
 * Resolves one user's effective permissions. A user with no role row gets an
 * empty map, which denies everything except their own profile.
 */
export async function loadPermissionsForUser(
  client: RbacClient,
  userId: string,
): Promise<PermissionMap> {
  const { data, error } = await client
    .from('user_roles')
    .select(
      'role_id, role_permissions:roles(role_permissions(section, can_view, can_manage))',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return {};
  }

  const nested = data as unknown as {
    role_permissions: {
      role_permissions: Array<{
        section: string;
        can_view: boolean;
        can_manage: boolean;
      }>;
    } | null;
  };

  const grants = nested.role_permissions?.role_permissions ?? [];

  return Object.fromEntries(
    grants.map((g) => [
      g.section,
      { canView: g.can_view, canManage: g.can_manage },
    ]),
  );
}
