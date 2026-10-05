import { redirect } from 'next/navigation';

import appConfig from '@kit/brand/config/app';

/**
 * The router never sends "/" to the portal. This exists only for `pnpm dev`,
 * where the portal runs on its own port and a logo click should still reach
 * the public site.
 */
export default function PortalRoot() {
  redirect(appConfig.url);
}
