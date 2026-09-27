import Link from 'next/link';

import { Suspense } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@kit/ui/sidebar';
import { SidebarNavigation } from '@kit/ui/sidebar-navigation';
import { Skeleton } from '@kit/ui/skeleton';

import { AppEmblem, AppLogo } from '~/components/app-logo';
import { ProfileAccountDropdownContainer } from '~/components/personal-account-dropdown-container';
import type { navigationConfig } from '~/config/navigation.config';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

/**
 * The logo and the navigation do not depend on the user, so they prerender.
 * Only the account dropdown in the footer needs the session, so only that sits
 * behind a boundary. Taking the user as a prop here would push the await up
 * into the layout and make the whole sidebar, and everything under it, wait.
 */
export function HomeSidebar({ config }: { config: typeof navigationConfig }) {
  return (
    <Sidebar collapsible={'icon'}>
      <SidebarHeader className={'h-16 justify-center'}>
        {/*
          Collapsed, this header is `--sidebar-width-icon` (3rem) wide, which
          leaves the horizontal lockup about 31x14.5px - too small to read. The
          square emblem is swapped in at that breakpoint via the sidebar root's
          `data-collapsible="icon"` group, so the two marks trade places in CSS
          with no extra client state. The swap lives on wrapper elements rather
          than on `AppLogo`'s own className, because that className shares a
          slot with the `dark:` variant classes and tailwind-merge would let one
          override the other.
        */}
        <Link
          aria-label={'Home Page'}
          href={'/'}
          className={'flex items-center justify-center'}
        >
          <span className={'group-data-[collapsible=icon]:hidden'}>
            <AppLogo href={null} className={'max-w-full'} />
          </span>

          <span className={'hidden group-data-[collapsible=icon]:block'}>
            <AppEmblem />
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarNavigation config={config} />
      </SidebarContent>

      <SidebarFooter>
        <Suspense fallback={<AccountDropdownFallback />}>
          <AccountDropdown />
        </Suspense>
      </SidebarFooter>
    </Sidebar>
  );
}

async function AccountDropdown() {
  const user = await requireUserInServerComponent();

  return <ProfileAccountDropdownContainer user={user} />;
}

function AccountDropdownFallback() {
  return (
    <div className={'flex items-center gap-x-2 p-2'}>
      <Skeleton className={'size-8 shrink-0 rounded-full'} />
      <Skeleton className={'h-4 w-full'} />
    </div>
  );
}
