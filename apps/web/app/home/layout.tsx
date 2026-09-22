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
 * Everything this layout renders depends on who is asking: it awaits the
 * session, may redirect on `must_change_password`, and filters the navigation
 * by the caller's permissions. With Cache Components enabled there is no
 * useful static shell to prerender ahead of knowing the user, so the correct
 * answer is to let the segment block rather than to fake a cacheable shape.
 *
 * Without this, `next build` fails on every /home route with "encountered
 * uncached data during prerendering", pointing at the awaited `connection()`
 * in `requireUserInServerComponent`. That `connection()` is deliberate and
 * must stay: it also keeps the Supabase client's `Math.random()` seed out of
 * the prerender, which `instant = false` alone would NOT excuse -- synchronous
 * IO fails a prerender regardless of this flag.
 *
 * `instant = false` marks the segment as allowed to block; it does not force
 * the route to be dynamic. See next/dist/docs/01-app/02-guides/
 * migrating-to-cache-components.md.
 */
export const instant = false;

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
