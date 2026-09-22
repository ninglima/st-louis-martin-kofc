import { getTranslations } from 'next-intl/server';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createPageMetadata } from '~/lib/page-metadata';

/**
 * `index: false` because the body below is still MakerKit's placeholder text
 * -- and the wrong placeholder at that: it says "terms of service" on a
 * privacy page. A real policy is escalated to the council; until it lands,
 * this page must not be a search result under a parish's name. It stays linked
 * from the footer -- a site should link its legal pages -- and it stays out of
 * the sitemap (`SITEMAP_ROUTES` in `config/site-navigation.config.ts`).
 *
 * REMOVE the `index: false` argument, and the corresponding filter in
 * `SITEMAP_ROUTES`, as soon as the council supplies real copy.
 */
export async function generateMetadata() {
  const t = await getTranslations();

  return createPageMetadata({
    title: t('marketing.privacyPolicy'),
    description: t('marketing.privacyPolicyDescription'),
    path: '/privacy-policy',
    index: false,
  });
}

async function PrivacyPolicyPage() {
  const t = await getTranslations();

  return (
    <div>
      <SitePageHeader
        title={t('marketing.privacyPolicy')}
        subtitle={t('marketing.privacyPolicyDescription')}
      />

      <div className={'container mx-auto py-8'}>
        <div>Your terms of service content here</div>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
