import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageHeader } from '@kit/ui/page';

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

async function UsersLayout(props: React.PropsWithChildren) {
  await requirePermission('users', 'view');

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      {props.children}
    </>
  );
}

export default UsersLayout;
