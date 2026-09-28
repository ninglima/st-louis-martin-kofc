import type { Metadata } from 'next';

import { SiteHeader } from '~/(marketing)/_components/site-header';

import { PleaseWaitClient } from './please-wait-client';

export const metadata: Metadata = {
  title: 'Please wait...',
  robots: { index: false, follow: false },
};

export default function PleaseWaitPage() {
  return (
    <div className={'flex min-h-screen flex-col'}>
      <SiteHeader />
      <main className={'container flex-1'}>
        <PleaseWaitClient />
      </main>
    </div>
  );
}
