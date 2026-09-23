import { RosterImportForm } from '@kit/members/components/roster-import-form';
import { PageBody, PageHeader } from '@kit/ui/page';

import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard below can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. The parent
 * layout's `instant = false` does not cover sibling segments -- navigations
 * between /home pages are still validated -- so each one declares its own.
 * See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

export const generateMetadata = async () => {
  return { title: 'Import roster' };
};

async function RosterImportPage() {
  // The Financial Secretary's grant, checked before the screen exists rather
  // than only inside the actions. Both actions re-check it on every call --
  // this guard is about not showing the roster's shape to somebody who may
  // not manage it.
  await requirePermission('members', 'manage');

  return (
    <>
      <PageHeader
        title={'Import roster'}
        description={'Upload the Supreme membership export'}
      />

      <PageBody>
        <RosterImportForm />
      </PageBody>
    </>
  );
}

export default RosterImportPage;
