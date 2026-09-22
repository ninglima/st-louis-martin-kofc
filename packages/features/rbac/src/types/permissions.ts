import type { SectionKey, Verb } from './sections';

export interface SectionGrant {
  canView: boolean;
  canManage: boolean;
}

export type PermissionMap = Record<string, SectionGrant>;

export function emptyPermissions(): PermissionMap {
  return {};
}

/**
 * `manage` implies `view`. Encoded here only, so the two can never disagree.
 * Mirrors the CASE expression in kit.has_permission().
 */
export function hasPermission(
  perms: PermissionMap,
  section: SectionKey | string,
  verb: Verb,
): boolean {
  const grant = perms[section];

  if (!grant) {
    return false;
  }

  return verb === 'manage' ? grant.canManage : grant.canView || grant.canManage;
}
