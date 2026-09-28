import { PaidThroughImport } from '@kit/dues/components/paid-through-import';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction, same reasoning as `/home/members`: this segment
 * reads the caller's permissions, and the guard below can redirect, so there
 * is no shell worth prerendering ahead of knowing who is asking.
 */
export const instant = false;

export const generateMetadata = async () => {
  return { title: 'Load paid-through dates' };
};

async function DuesImportPage() {
  // The `previewPaidThroughAction`/`applyPaidThroughAction` re-check this on
  // every call -- this guard is about not showing the screen's shape to
  // somebody who may not manage dues, same as `/home/members/import` for
  // `members.manage`.
  await requirePermission('finance', 'manage');

  return (
    <>
      <PageHeader
        title={'Load paid-through dates'}
        description={
          'One-off: load each member’s paid-through date from a CSV export'
        }
      />

      <PageBody>
        <PaidThroughImport />
      </PageBody>
    </>
  );
}

export default DuesImportPage;
