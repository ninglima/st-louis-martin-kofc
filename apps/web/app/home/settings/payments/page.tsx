import { Suspense } from 'react';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageBody } from '@kit/ui/page';
import { Skeleton } from '@kit/ui/skeleton';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { PaymentSettingsForm } from '@kit/payments/components/payment-settings-form';
import type { PaymentConfig } from '@kit/payments/types';
import { Delayed } from '~/components/skeletons/page-skeletons';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

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
  const user = await requireUserInServerComponent();
  const adminClient = getSupabaseServerAdminClient();

  const { data: adminUser } = await adminClient
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .single();

  if (!adminUser) {
    redirect('/home');
  }

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
