import { getMessages } from 'next-intl/server';

import { heading, sans } from '@kit/brand/fonts';
import { BaseProviders } from '@kit/brand/providers';
import { generateRootMetadata } from '@kit/brand/root-metadata';
import { routing } from '@kit/i18n/routing';
import { cn } from '@kit/ui/utils';

import { PortalPrewarm } from '~/components/portal-prewarm';

import '../styles/globals.css';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = routing.defaultLocale;
  const messages = await getMessages({ locale });

  return (
    <html
      lang={locale}
      className={cn(
        'bg-background min-h-screen antialiased',
        sans.variable,
        heading.variable,
      )}
      suppressHydrationWarning
    >
      <body>
        <BaseProviders locale={locale} messages={messages}>
          {children}
        </BaseProviders>
        <PortalPrewarm />
      </body>
    </html>
  );
}

export const generateMetadata = generateRootMetadata;
