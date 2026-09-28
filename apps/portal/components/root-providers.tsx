'use client';

import dynamic from 'next/dynamic';

import type { AbstractIntlMessages } from 'next-intl';

import { CaptchaProvider } from '@kit/auth/captcha/client';
import appConfig from '@kit/brand/config/app';
import featuresFlagConfig from '@kit/brand/config/feature-flags';
import { BaseProviders } from '@kit/brand/providers';
import { If } from '@kit/ui/if';
import { VersionUpdater } from '@kit/ui/version-updater';

import { AuthProvider } from '~/components/auth-provider';
import authConfig from '~/config/auth.config';

const captchaSiteKey = authConfig.captchaTokenSiteKey;

const CaptchaTokenSetter = dynamic(async () => {
  if (!captchaSiteKey) {
    return Promise.resolve(() => null);
  }

  const { CaptchaTokenSetter } = await import('@kit/auth/captcha/client');

  return {
    default: CaptchaTokenSetter,
  };
});

export function RootProviders({
  locale,
  messages,
  theme = appConfig.theme,
  children,
}: React.PropsWithChildren<{
  locale: string;
  messages: AbstractIntlMessages;
  theme?: string;
}>) {
  return (
    <BaseProviders locale={locale} messages={messages} theme={theme}>
      <CaptchaProvider>
        <CaptchaTokenSetter siteKey={captchaSiteKey} />

        <AuthProvider>{children}</AuthProvider>
      </CaptchaProvider>

      <If condition={featuresFlagConfig.enableVersionUpdater}>
        <VersionUpdater />
      </If>
    </BaseProviders>
  );
}
