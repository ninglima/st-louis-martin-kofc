import type { MetadataRoute } from 'next';

import appConfig from '@kit/brand/config/app';

import { SITEMAP_ROUTES } from '~/config/site-navigation.config';

export const dynamic = 'force-static';

/**
 * Derived from `SITEMAP_ROUTES`, never a literal list:
 * `site-navigation.routes.test.ts` asserts this file still reads it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return SITEMAP_ROUTES.map((path) => ({
    url: new URL(path, appConfig.url).href,
    lastModified,
  }));
}
