import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentHistoryTable } from '@kit/payments/components/payment-history-table';
import { PaymentService } from '@kit/payments/server/payment.service';
import { Delayed } from '~/components/skeletons/page-skeletons';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

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
  const user = await requireUserInServerComponent();
  const adminClient = getSupabaseServerAdminClient();

  const { data: adminUser } = await adminClient
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .single();

  const isAdmin = !!adminUser;

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
