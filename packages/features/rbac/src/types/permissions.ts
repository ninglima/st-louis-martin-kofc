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
 * Mirrors the CASE expression in kit.has_permission(), including its
 * `else false` branch for any verb that is neither `manage` nor `view`.
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

  if (verb === 'manage') {
    return grant.canManage;
  }

  if (verb === 'view') {
    return grant.canView || grant.canManage;
  }

  return false;
}
