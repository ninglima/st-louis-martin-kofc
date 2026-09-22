import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. The parent
 * layout's `instant = false` does not cover sibling segments -- navigations
 * between /home pages are still validated -- so each one declares its own.
 * See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

/**
 * No `<PageHeader>` here: the parent `settings/layout.tsx` already renders one
 * with `<AppBreadcrumbs />`, and this layout nests inside it, so rendering a
 * second produced two identical breadcrumb bars stacked on /home/settings/roles.
 * The breadcrumbs derive from the path, so the parent's already reads
 * "Home > Settings > Roles".
 */
async function RolesLayout(props: React.PropsWithChildren) {
  await requirePermission('roles', 'view');

  return props.children;
}

export default RolesLayout;
