import { MetadataRoute } from 'next';

import appConfig from '@kit/brand/config/app';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${appConfig.url}/sitemap.xml`,
  };
}
