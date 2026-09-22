import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

async function RolesLayout(props: React.PropsWithChildren) {
  await requirePermission('roles', 'view');

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      {props.children}
    </>
  );
}

export default RolesLayout;
