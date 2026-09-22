import { hasPermission, type PermissionMap } from '../types/permissions';
import type { Verb } from '../types/sections';

interface GatedEntry {
  section?: string;
  verb?: Verb;
}

interface RouteGroupLike {
  label: string;
  children: Array<GatedEntry & Record<string, unknown>>;
}

type RouteEntry = RouteGroupLike | { divider: true };

function isDivider(entry: RouteEntry): entry is { divider: true } {
  return 'divider' in entry;
}

/** An entry with no `section` is ungated and always visible. */
function isVisible(entry: GatedEntry, perms: PermissionMap): boolean {
  if (!entry.section) {
    return true;
  }

  return hasPermission(perms, entry.section, entry.verb ?? 'view');
}

export function filterRoutesByPermission<T extends RouteEntry>(
  routes: readonly T[],
  perms: PermissionMap,
): T[] {
  const result: T[] = [];

  for (const entry of routes) {
    if (isDivider(entry)) {
      result.push(entry);
      continue;
    }

    const children = entry.children.filter((child) => isVisible(child, perms));

    if (children.length > 0) {
      result.push({ ...entry, children } as T);
    }
  }

  return result;
}
