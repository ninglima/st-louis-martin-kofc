import 'server-only';

import { cache } from 'react';

import { redirect } from 'next/navigation';

import { loadPermissionsForUser } from '@kit/rbac/server/permissions.service';
import type { SectionKey, Verb } from '@kit/rbac/sections';
import type { PermissionMap } from '@kit/rbac/types';
import { hasPermission } from '@kit/rbac/types';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { requireUserInServerComponent } from './require-user-in-server-component';

/**
 * Cached per request, so a page that guards in its layout and again in the
 * page body still costs a single query.
 */
export const getCurrentPermissions = cache(async (): Promise<PermissionMap> => {
  const user = await requireUserInServerComponent();

  return loadPermissionsForUser(getSupabaseServerAdminClient(), user.id);
});

export async function requirePermission(
  section: SectionKey,
  verb: Verb,
): Promise<void> {
  const perms = await getCurrentPermissions();

  if (!hasPermission(perms, section, verb)) {
    redirect('/home');
  }
}
