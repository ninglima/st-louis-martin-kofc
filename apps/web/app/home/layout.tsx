import { filterRoutesByPermission } from '@kit/rbac/server/filter-navigation';
import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/sidebar';

import { AppLogo } from '~/components/app-logo';
import { navigationConfig } from '~/config/navigation.config';
import { getCurrentPermissions } from '~/lib/server/require-permission';

// home imports
import { HomeMenuNavigation } from './_components/home-menu-navigation';
import { HomeMobileNavigation } from './_components/home-mobile-navigation';
import { HomeSidebar } from './_components/home-sidebar';

/**
 * The nav is filtered by the current user's permissions on every request
 * (getCurrentPermissions is React-cache()d, so this costs one query even
 * though the page guard behind each route also calls it). This is purely
 * cosmetic: it hides links the user cannot use. It does not secure
 * anything — the page guard (requirePermission) and RLS are what enforce
 * access; a filtered-out route is still reachable by URL if those are
 * missing.
 */
async function HomeLayout({ children }: React.PropsWithChildren) {
  const permissions = await getCurrentPermissions();

  const filteredConfig = {
    ...navigationConfig,
    routes: filterRoutesByPermission(navigationConfig.routes, permissions),
  };

  if (navigationConfig.style === 'sidebar') {
    return <SidebarLayout config={filteredConfig}>{children}</SidebarLayout>;
  }

  return <HeaderLayout config={filteredConfig}>{children}</HeaderLayout>;
}

export default HomeLayout;

function SidebarLayout({
  children,
  config,
}: React.PropsWithChildren<{ config: typeof navigationConfig }>) {
  return (
    <SidebarProvider defaultOpen={navigationConfig.sidebarCollapsed}>
      <Page style={'sidebar'}>
        <PageNavigation>
          <HomeSidebar config={config} />
        </PageNavigation>

        <PageMobileNavigation className={'flex items-center justify-between'}>
          <MobileNavigation config={config} />
        </PageMobileNavigation>

        {children}
      </Page>
    </SidebarProvider>
  );
}

function HeaderLayout({
  children,
  config,
}: React.PropsWithChildren<{ config: typeof navigationConfig }>) {
  return (
    <Page style={'header'}>
      <PageNavigation>
        <HomeMenuNavigation config={config} />
      </PageNavigation>

      <PageMobileNavigation className={'flex items-center justify-between'}>
        <MobileNavigation config={config} />
      </PageMobileNavigation>

      {children}
    </Page>
  );
}

function MobileNavigation({ config }: { config: typeof navigationConfig }) {
  return (
    <>
      <AppLogo />

      <HomeMobileNavigation config={config} />
    </>
  );
}
