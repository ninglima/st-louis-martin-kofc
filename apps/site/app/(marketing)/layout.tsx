import { Trans } from '@kit/ui/trans';

import { SiteFooter } from '~/(marketing)/_components/site-footer';
import { SiteHeader } from '~/(marketing)/_components/site-header';

/**
 * Synchronous on purpose. This layout used to await the session so the header
 * could render the signed-in state, which put user data into the server HTML of
 * every marketing page and forced them out of shared caches. The header now
 * reads the session on the client, so this response is identical for everyone.
 */
function SiteLayout(props: React.PropsWithChildren) {
  return (
    <div className={'flex min-h-[100vh] flex-col'}>
      {/*
       * `@kit/ui`'s `Header` renders a `<div>`, so without this the only
       * landmark on the whole marketing document is the footer and a screen
       * reader has no way to jump past the navigation. The skip link is the
       * first thing in the tab order and is `sr-only` until it takes focus.
       */}
      <a
        href={'#main-content'}
        className={
          'sr-only focus:bg-background focus:text-foreground focus:ring-ring focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:ring-2'
        }
        data-test={'skip-to-content'}
      >
        <Trans i18nKey={'marketing.skipToContent'} />
      </a>

      <SiteHeader />

      {/*
       * `flex flex-col` on purpose: page content used to be a direct child of
       * this column, so every top-level element a page rendered was a flex
       * item. Wrapping them in a plain block `<main>` would re-introduce margin
       * collapsing between them and change spacing on pages that render more
       * than one section. Keeping the flex context makes this wrapper purely
       * semantic — no page's layout moves.
       *
       * `tabIndex={-1}` so the skip link above actually moves focus here rather
       * than only moving the scroll position; `focus:outline-none` because the
       * target of a skip link is not itself an interactive control.
       */}
      <main
        id={'main-content'}
        tabIndex={-1}
        className={'flex flex-col focus:outline-none'}
      >
        {props.children}
      </main>

      <SiteFooter />
    </div>
  );
}

export default SiteLayout;
