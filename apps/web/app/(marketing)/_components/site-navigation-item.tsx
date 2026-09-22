'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NavigationMenuItem } from '@kit/ui/navigation-menu';
import { cn, isRouteActive } from '@kit/ui/utils';

/**
 * Semantic tokens only. This shipped as `dark:text-gray-300` /
 * `dark:text-white`, which pinned the top-level navigation of all 24 public
 * routes to Tailwind's palette rather than the council's: revise the dark
 * palette in `styles/shadcn-ui.css` and the nav would silently ignore it.
 *
 * The `dark:`-only spelling also meant light mode had no active state at all
 * -- `text-current` and the inherited colour are the same colour -- so the
 * current page was only distinguishable in dark mode. `text-foreground/80` is
 * the same token pair `home-stats-bar.tsx` settled on for dimmed-but-legible
 * copy, and it gives both themes the same two-step contrast.
 */
const getClassName = (path: string, currentPathName: string) => {
  const isActive = isRouteActive(path, currentPathName);

  return cn(
    `inline-flex w-max text-sm font-medium transition-colors duration-300`,
    {
      'text-foreground/80 hover:text-foreground': !isActive,
      'text-foreground': isActive,
    },
  );
};

export function SiteNavigationItem({
  path,
  children,
}: React.PropsWithChildren<{
  path: string;
}>) {
  const currentPathName = usePathname();
  const className = getClassName(path, currentPathName);

  return (
    <NavigationMenuItem key={path}>
      <Link className={className} href={path} data-test={`nav-link-${path}`}>
        {children}
      </Link>
    </NavigationMenuItem>
  );
}
