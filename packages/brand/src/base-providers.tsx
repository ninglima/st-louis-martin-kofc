'use client';

import type { AbstractIntlMessages } from 'next-intl';
import { ThemeProvider } from 'next-themes';

import { I18nClientProvider } from '@kit/i18n/provider';

import appConfig from './config/app.config';
import featuresFlagConfig from './config/feature-flags.config';
import { ReactQueryProvider } from './react-query-provider';

/**
 * The providers both apps need: data fetching (the header's `useUser` reads
 * the session through React Query), translations and the theme. The portal
 * wraps these with its captcha, auth listener and version updater; the static
 * site uses them as they are.
 */
export function BaseProviders({
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
    <ReactQueryProvider>
      <I18nClientProvider locale={locale} messages={messages}>
        <ThemeProvider
          attribute="class"
          enableSystem
          disableTransitionOnChange
          defaultTheme={theme}
          // With the toggle off there is no way to change theme, so a choice
          // a visitor made earlier (kept in their browser) is ignored rather
          // than leaving them stuck in it.
          forcedTheme={featuresFlagConfig.enableThemeToggle ? undefined : theme}
          enableColorScheme={false}
        >
          {children}
        </ThemeProvider>
      </I18nClientProvider>
    </ReactQueryProvider>
  );
}
