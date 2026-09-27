import { Suspense } from 'react';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentSettingsForm } from '@kit/payments/components/payment-settings-form';
import type { PaymentConfig } from '@kit/payments/types';
import { Delayed } from '~/components/skeletons/page-skeletons';
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

export const generateMetadata = async () => {
  const t = await getTranslations();
  return { title: t('payments.settingsTitle') };
};

function PaymentSettingsPage() {
  return (
    <PageBody>
      <div className="flex w-full flex-1 flex-col lg:max-w-2xl">
        <Suspense fallback={<PaymentSettingsSkeleton />}>
          <PaymentSettingsContent />
        </Suspense>
      </div>
    </PageBody>
  );
}

async function PaymentSettingsContent() {
  await requirePermission('payment_settings', 'manage');

  const adminClient = getSupabaseServerAdminClient();

  const { data: config } = await adminClient
    .from('payment_config')
    .select('*')
    .single();

  if (!config) {
    redirect('/home');
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  return (
    <PaymentSettingsForm
      config={config as PaymentConfig}
      webhookBaseUrl={siteUrl}
    />
  );
}

function PaymentSettingsSkeleton() {
  return (
    <Delayed className="flex flex-col gap-y-4">
      <Skeleton className="h-96 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </Delayed>
  );
}

export default PaymentSettingsPage;
