import type React from 'react';

import Link from 'next/link';

import { isPortalPath } from '@kit/brand/config/paths';

import { portalHref } from '~/lib/portal-href';

type SiteLinkProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  href: string;
};

/**
 * A portal page is not part of this static export. `next/link` would try a
 * client-side transition and request an RSC payload that does not exist, so
 * portal links are plain anchors and do a full page load through the router.
 */
export function SiteLink({ href, ...props }: SiteLinkProps) {
  const pathname = href.split(/[?#]/, 1)[0] ?? href;

  if (href.startsWith('/') && isPortalPath(pathname)) {
    return <a href={portalHref(href)} {...props} />;
  }

  return <Link href={href} {...props} />;
}
