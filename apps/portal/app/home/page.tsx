import { Suspense } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';

import { MemberHomeContent } from './_components/member-home-content';

/**
 * Per-user by construction: this segment reads the caller's session so the
 * member home can show their own dues and volunteering. See the fuller note
 * in app/home/layout.tsx.
 */
export const instant = false;

export default function HomePage() {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <HomeContent />
        </Suspense>
      </PageBody>
    </>
  );
}

async function HomeContent() {
  return <MemberHomeContent client={getSupabaseServerClient()} />;
}
