'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import { PersonalAccountDropdown } from '@kit/accounts/personal-account-dropdown';
import { useSignOut } from '@kit/supabase/hooks/use-sign-out';
import { useUser } from '@kit/supabase/hooks/use-user';
import { Button } from '@kit/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@kit/ui/dropdown-menu';
import { If } from '@kit/ui/if';
import { SubMenuModeToggle } from '@kit/ui/mode-toggle';
import { Trans } from '@kit/ui/trans';

import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';

const ModeToggle = dynamic(
  () =>
    import('@kit/ui/mode-toggle').then((mod) => ({
      default: mod.ModeToggle,
    })),
  {
    ssr: false,
  },
);

const paths = {
  home: pathsConfig.app.home,
};

const features = {
  enableThemeToggle: featuresFlagConfig.enableThemeToggle,
};

/**
 * The session is read on the client, never on the server. Reading it in the
 * marketing layout put user data into the server HTML, which is why those pages
 * had to be kept out of shared caches. The server response is now identical for
 * every visitor, so marketing pages are safe on any CDN.
 *
 * The trade-off is that a signed-in visitor briefly sees the signed-out actions
 * until the session resolves on the client.
 */
export function SiteHeaderAccountSection() {
  const signOut = useSignOut();
  const { data: user } = useUser();

  if (!user) {
    return <AuthButtons />;
  }

  return (
    <PersonalAccountDropdown
      showProfileName={false}
      paths={paths}
      features={features}
      user={user}
      signOutRequested={() => signOut.mutateAsync()}
    />
  );
}

/**
 * The Sign In button and the theme toggle live in a `md:` -only row of the
 * header, because three controls plus the logo plus the hamburger overflow a
 * 390px viewport. Below `md` they are reached from the navigation dropdown
 * instead, which is where every other header affordance already lives on a
 * phone. Rendered only for a signed-out visitor: once signed in the account
 * dropdown is visible at every width and already carries the theme submenu, so
 * duplicating it here would put two theme controls on the same screen.
 *
 * `DropdownMenuItem`/`SubMenuModeToggle` rather than buttons: these are handed
 * to `SiteNavigation` and rendered inside its `DropdownMenuContent`, so they
 * have to be menu children to keep the menu's roving focus and roles intact.
 */
export function SiteHeaderMobileMenuActions() {
  const { data: user } = useUser();

  if (user) {
    return null;
  }

  return (
    <>
      <DropdownMenuSeparator />

      <DropdownMenuItem
        render={
          <Link
            className={'flex h-full w-full items-center'}
            href={pathsConfig.auth.signIn}
            data-test={'mobile-sign-in'}
          />
        }
      >
        <Trans i18nKey={'auth.signIn'} />
      </DropdownMenuItem>

      <If condition={features.enableThemeToggle}>
        <DropdownMenuSeparator />

        <SubMenuModeToggle />
      </If>
    </>
  );
}

function AuthButtons() {
  return (
    <div className={'flex space-x-2'}>
      <div className={'hidden space-x-0.5 md:flex'}>
        <If condition={features.enableThemeToggle}>
          <ModeToggle />
        </If>

        <Button
          nativeButton={false}
          render={<Link href={pathsConfig.auth.signIn} />}
          variant={'ghost'}
        >
          <Trans i18nKey={'auth.signIn'} />
        </Button>
      </div>

      <Button
        nativeButton={false}
        render={<Link href={pathsConfig.auth.signUp} />}
        className="group"
        variant={'default'}
      >
        <Trans i18nKey={'auth.signUp'} />
      </Button>
    </div>
  );
}
