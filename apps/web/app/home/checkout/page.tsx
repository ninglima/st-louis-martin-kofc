import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { PageBody, PageHeader } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { CheckoutForm } from '@kit/payments/components/checkout-form';
import { Delayed } from '~/components/skeletons/page-skeletons';
import { requirePermission } from '~/lib/server/require-permission';

import type { PublicPaymentConfig } from '@kit/payments/types';

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
  return { title: t('payments.checkout') };
};

function CheckoutPage() {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <div className="flex w-full flex-1 flex-col lg:max-w-2xl">
          <Suspense fallback={<CheckoutSkeleton />}>
            <CheckoutContent />
          </Suspense>
        </div>
      </PageBody>
    </>
  );
}

async function CheckoutContent() {
  await requirePermission('checkout', 'view');
  const adminClient = getSupabaseServerAdminClient();

  const { data: configData } = await adminClient
    .from('payment_config')
    .select(
      'active_provider, stripe_publishable_key, square_application_id, square_location_id, environment',
    )
    .single();

  const config: PublicPaymentConfig = {
    activeProvider: (configData?.active_provider ??
      'square') as PublicPaymentConfig['activeProvider'],
    publishableKey:
      configData?.active_provider === 'stripe'
        ? (configData?.stripe_publishable_key ?? null)
        : (configData?.square_application_id ?? null),
    locationId: configData?.square_location_id ?? null,
    environment: (configData?.environment ??
      'sandbox') as PublicPaymentConfig['environment'],
  };

  return <CheckoutForm config={config} />;
}

function CheckoutSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-64 w-full rounded-lg" />
    </Delayed>
  );
}

export default CheckoutPage;
