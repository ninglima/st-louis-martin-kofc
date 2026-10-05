import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { If } from '@kit/ui/if';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { MyDuesCard } from '@kit/dues/components/my-dues-card';
import { readDuesIfDeployed } from '@kit/dues/lib/dues-schema';
import { DuesService } from '@kit/dues/server/dues.service';
import { PaymentHistoryTable } from '@kit/payments/components/payment-history-table';
import { PaymentService } from '@kit/payments/server/payment.service';
import { hasPermission } from '@kit/rbac/types';
import { Delayed } from '@kit/brand/skeletons/page-skeletons';
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

  // The member's own session, not the admin client: `my_dues_summary` and
  // `my_dues_ledger` are both `security definer` and answer for `auth.uid()`
  // -- same reasoning `DuesService`'s own doc comment gives, and the same
  // client `/home/checkout` already reads its own summary through.
  const duesService = new DuesService(getSupabaseServerClient());

  // `readDuesIfDeployed`: before the dues migrations land (they deploy in
  // parallel with the app) the page is just the payment history, no card.
  const [payments, myDuesRead] = await Promise.all([
    paymentService.getPayments(user.id, isAdmin),
    readDuesIfDeployed(() => duesService.mySummary()),
  ]);

  // No members row linked to this sign-in: not an error, just nothing new
  // on a page every signed-in member can already reach.
  const myDues = myDuesRead.deployed ? myDuesRead.value : null;
  const myLedgerRead = myDues
    ? await readDuesIfDeployed(() => duesService.myLedger())
    : null;
  const myLedger = myLedgerRead?.deployed ? myLedgerRead.value : [];

  // Only the admin view has a Member column to fill.
  const payers = isAdmin
    ? await paymentService.getPayers(payments.map((p) => p.user_id))
    : undefined;

  return (
    <div className="flex flex-col gap-y-6">
      <If condition={myDues}>
        {(summary) => <MyDuesCard summary={summary} ledger={myLedger} />}
      </If>

      <PaymentHistoryTable
        payments={payments}
        showMember={isAdmin}
        payers={payers}
        linkMembers={hasPermission(perms, 'members', 'view')}
      />
    </div>
  );
}

function PaymentsSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-64 w-full rounded-lg" />
    </Delayed>
  );
}

export default PaymentsPage;
