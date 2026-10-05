import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { Delayed } from '@kit/brand/skeletons/page-skeletons';
import { DuesLevelsManager } from '@kit/dues/components/dues-levels-manager';
import { DuesService } from '@kit/dues/server/dues.service';
import { requirePermission } from '~/lib/server/require-permission';

/**
 * Per-user by construction: the guard reads the caller's permissions and can
 * redirect, so nothing is worth prerendering. See app/home/layout.tsx.
 */
export const instant = false;

export const metadata = { title: 'Dues Levels' };

function DuesLevelsPage() {
  return (
    <PageBody>
      <div className="flex w-full flex-1 flex-col">
        <Suspense fallback={<DuesLevelsSkeleton />}>
          <DuesLevelsContent />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function DuesLevelsContent() {
  await requirePermission('finance', 'manage');

  // The officer's own session: dues_levels_admin checks finance.manage
  // against the real caller (see DuesService).
  const levels = await new DuesService(getSupabaseServerClient()).adminLevels();

  return <DuesLevelsManager levels={levels} />;
}

function DuesLevelsSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-96 w-full rounded-lg" />
    </Delayed>
  );
}

export default DuesLevelsPage;
