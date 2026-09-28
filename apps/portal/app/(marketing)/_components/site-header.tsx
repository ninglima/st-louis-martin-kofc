import { Header } from '@kit/ui/marketing';

import { AppLogo } from '@kit/brand/app-logo';

import {
  SiteHeaderAccountSection,
  SiteHeaderMobileMenuActions,
} from './site-header-account-section';
import { SiteNavigation } from './site-navigation';

export function SiteHeader() {
  return (
    <Header
      logo={<AppLogo eager />}
      navigation={
        <SiteNavigation mobileFooter={<SiteHeaderMobileMenuActions />} />
      }
      actions={<SiteHeaderAccountSection />}
    />
  );
}
