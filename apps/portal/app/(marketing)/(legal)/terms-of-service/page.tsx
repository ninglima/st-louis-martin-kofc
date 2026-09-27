import { getTranslations } from 'next-intl/server';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createPageMetadata } from '~/lib/page-metadata';

/**
 * `index: false` because the body below is still MakerKit's placeholder text.
 * Real terms are escalated to the council; until they land, this page must not
 * be a search result under a parish's name. It stays linked from the footer --
 * a site should link its legal pages -- and it stays out of the sitemap
 * (`SITEMAP_ROUTES` in `config/site-navigation.config.ts`).
 *
 * REMOVE the `index: false` argument, and the corresponding filter in
 * `SITEMAP_ROUTES`, as soon as the council supplies real copy.
 */
export async function generateMetadata() {
  const t = await getTranslations();

  return createPageMetadata({
    title: t('marketing.termsOfService'),
    description: t('marketing.termsOfServiceDescription'),
    path: '/terms-of-service',
    index: false,
  });
}

async function TermsOfServicePage() {
  const t = await getTranslations();

  return (
    <div>
      <SitePageHeader
        title={t(`marketing.termsOfService`)}
        subtitle={t(`marketing.termsOfServiceDescription`)}
      />

      <div className={'container mx-auto py-8'}>
        <div>Your terms of service content here</div>
      </div>
    </div>
  );
}

export default TermsOfServicePage;
