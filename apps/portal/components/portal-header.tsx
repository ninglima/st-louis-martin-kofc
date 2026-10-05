import { AppLogo } from '@kit/brand/app-logo';

/** The portal's error pages are not part of the public site, so a logo home is enough. */
export function PortalHeader() {
  return (
    <header className={'border-b px-4 py-3'}>
      <AppLogo href={'/'} label={'Home Page'} eager />
    </header>
  );
}
