import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentHistoryTable } from '@kit/payments/components/payment-history-table';
import { PaymentService } from '@kit/payments/server/payment.service';
import { hasPermission } from '@kit/rbac/types';
import { Delayed } from '~/components/skeletons/page-skeletons';
import {
  getCurrentPermissions,
  requirePermission,
} from '~/lib/server/require-permission';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

/**
 * Per-user by construction: this segment reads the caller's session and
 * permissions, and the guard can redirect, so there is no shell worth
 * prerendering or streaming ahead of knowing who is asking. The parent
 * layout's `instant = false` does not cover sibling segments -- navigations
 * between /home pages are still validated -- so each one declares its own.
 * See the fuller note in app/home/layout.tsx.
 */
export const instant = false;

export const generateMetadata = async () => {
  const t = await getTranslations();
  return { title: t('payments.paymentHistory') };
};

function PaymentsPage() {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <div className="flex w-full flex-1 flex-col">
          <Suspense fallback={<PaymentsSkeleton />}>
            <PaymentsContent />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

async function PaymentsContent() {
  await requirePermission('payments', 'view');

  const user = await requireUserInServerComponent();
  const adminClient = getSupabaseServerAdminClient();

  const perms = await getCurrentPermissions();
  const isAdmin = hasPermission(perms, 'payments', 'manage');

  const paymentService = new PaymentService(adminClient);
  const payments = await paymentService.getPayments(user.id, isAdmin);

  return <PaymentHistoryTable payments={payments} showMember={isAdmin} />;
}

function PaymentsSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-64 w-full rounded-lg" />
    </Delayed>
  );
}

export default PaymentsPage;
