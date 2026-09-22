import Link from 'next/link';

import { Menu } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@kit/ui/navigation-menu';

import { SITE_NAV } from '~/config/site-navigation.config';

import { SiteNavigationItem } from './site-navigation-item';

/**
 * `mobileFooter` is appended to the bottom of the mobile dropdown. It exists so
 * the header's auth- and theme-dependent controls, which are client-rendered
 * and hidden below `md`, can still be reached on a phone without this server
 * component having to know anything about the session.
 */
export function SiteNavigation(props: { mobileFooter?: React.ReactNode }) {
  return (
    <>
      <div
        className={'hidden items-center justify-center md:flex'}
        data-test={'site-nav-desktop'}
      >
        <DesktopNavigation />
      </div>

      <div className={'flex justify-start sm:items-center md:hidden'}>
        <MobileDropdown footer={props.mobileFooter} />
      </div>
    </>
  );
}

function DesktopNavigation() {
  return (
    <NavigationMenu className={'px-4 py-2'}>
      <NavigationMenuList className={'space-x-5'}>
        {SITE_NAV.map((item) => {
          if (item.children?.length) {
            return (
              <NavigationMenuItem key={item.label}>
                <NavigationMenuTrigger>{item.label}</NavigationMenuTrigger>

                <NavigationMenuContent>
                  <ul className={'flex flex-col gap-1 p-2'}>
                    {item.children.map((child) => (
                      <li key={child.path}>
                        <Link
                          className={
                            'text-foreground hover:bg-muted flex w-max items-center rounded-lg p-2 text-sm transition-colors'
                          }
                          href={child.path}
                          data-test={`nav-link-${child.path}`}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            );
          }

          return (
            <SiteNavigationItem key={item.path} path={item.path as string}>
              {item.label}
            </SiteNavigationItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function MobileDropdown(props: { footer?: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={'Open Menu'}>
        <Menu className={'h-8 w-8'} />
      </DropdownMenuTrigger>

      <DropdownMenuContent className={'w-full'} data-test={'site-nav-mobile'}>
        {SITE_NAV.map((item) => {
          if (item.children?.length) {
            return (
              <div key={item.label} className={'flex flex-col'}>
                <span
                  className={
                    'text-muted-foreground px-1.5 py-1 text-xs font-medium'
                  }
                >
                  {item.label}
                </span>

                {item.children.map((child) => (
                  <DropdownMenuItem
                    key={child.path}
                    render={
                      <Link
                        className={'flex h-full w-full items-center pl-4'}
                        href={child.path}
                        data-test={`nav-link-${child.path}`}
                      />
                    }
                  >
                    {child.label}
                  </DropdownMenuItem>
                ))}
              </div>
            );
          }

          const path = item.path as string;

          return (
            <DropdownMenuItem
              key={path}
              render={
                <Link
                  className={'flex h-full w-full items-center'}
                  href={path}
                  data-test={`nav-link-${path}`}
                />
              }
            >
              {item.label}
            </DropdownMenuItem>
          );
        })}

        {props.footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
