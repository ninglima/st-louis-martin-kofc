import { hasPermission, type PermissionMap } from '../types/permissions';
import type { Verb } from '../types/sections';

interface GatedEntry {
  section?: string;
  verb?: Verb;
  children?: ReadonlyArray<GatedEntry & Record<string, unknown>>;
}

type GatedRecord = GatedEntry & Record<string, unknown>;

interface RouteGroupLike {
  label: string;
  children: GatedRecord[];
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

/**
 * Filters a list of gated entries -- route children, or their nested
 * sub-children -- and recurses into any nested `children`. The schema
 * declares `section`/`verb` on both `RouteChild` and `RouteSubChild`
 * (`packages/ui/src/makerkit/navigation-config.schema.ts`), so a gated
 * sub-child must not leak through simply because its parent is visible.
 */
function filterChildren(
  children: readonly GatedRecord[],
  perms: PermissionMap,
): GatedRecord[] {
  return children
    .filter((child) => isVisible(child, perms))
    .map((child) => {
      if (!child.children || child.children.length === 0) {
        return child;
      }

      return { ...child, children: filterChildren(child.children, perms) };
    });
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

    const children = filterChildren(entry.children, perms);

    if (children.length > 0) {
      result.push({ ...entry, children } as T);
    }
  }

  return result;
}
