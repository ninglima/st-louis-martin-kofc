import { redirect } from 'next/navigation';

import { filterRoutesByPermission } from '@kit/rbac/server/filter-navigation';
import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/sidebar';

import { AppLogo } from '~/components/app-logo';
import pathsConfig from '~/config/paths.config';
import { navigationConfig } from '~/config/navigation.config';
import { getCurrentPermissions } from '~/lib/server/require-permission';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

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
  // requireUserInServerComponent() is React-cache()d and is also called
  // internally by getCurrentPermissions() below, so reading the user here
  // as well costs nothing extra.
  //
  // `user` is the JWT claims payload (from `supabase.auth.getClaims()`),
  // which -- per @supabase/auth-js's documented `getClaims()` response
  // shape and the `JwtPayload` type -- includes `user_metadata` as a claim
  // by default (no custom access-token hook changes that in this project).
  // That is what `UsersService.createUserWithPassword` sets
  // `must_change_password: true` on, so it is safe to read it directly off
  // the claims rather than making an extra `getUser()` round trip.
  const user = await requireUserInServerComponent();

  const mustChangePassword = Boolean(
    (user.user_metadata as { must_change_password?: boolean } | undefined)
      ?.must_change_password,
  );

  // /update-password lives outside /home, so this can never loop: once
  // there, this layout no longer runs. The flag is cleared alongside the
  // password change in `UpdatePasswordForm` (packages/features/auth), which
  // is the only way back into /home from here.
  if (mustChangePassword) {
    redirect(pathsConfig.auth.passwordUpdate);
  }

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
