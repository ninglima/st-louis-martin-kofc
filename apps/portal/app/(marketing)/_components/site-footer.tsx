import { cacheLife } from 'next/cache';
import Link from 'next/link';

import { Trans } from '@kit/ui/trans';

import { AppLogo } from '~/components/app-logo';
import { LEGAL_LINKS, SITE_NAV } from '~/config/site-navigation.config';

const COUNCIL_EMAIL = 'kofc15256@googlegroups.com';
const GRAND_KNIGHT = 'Steve Shields';

const INSURANCE_AGENT = {
  name: 'Bill Lupinacci',
  phone: '703-624-9687',
  tel: '+17036249687',
  email: 'bill.lupinacci@kofc.org',
};

/**
 * The live site's footer menu is the top level of the main navigation, so it
 * is derived from the same config rather than copied. Three of those items are
 * dropdown triggers with no route of their own; each one's first child is its
 * landing page ("Who We Are" opens "About Our Council", and so on), which is
 * exactly where the live footer's link points. Deriving it here means a
 * renamed or re-ordered page cannot leave a stale second copy of the site map
 * behind in the footer. `config/site-navigation.config.test.ts` pins the
 * first-child assumption, so re-ordering a dropdown's children fails there
 * rather than silently re-targeting one of these links.
 */
const QUICK_LINKS = SITE_NAV.flatMap((item) => {
  const path = item.path ?? item.children?.[0]?.path;

  return path ? [{ label: item.label, path }] : [];
});

/**
 * The social accounts the council links from its own footer. The Facebook
 * entry points at the network's front page rather than a council page, which
 * is how the live site has it: the council has never linked a specific page.
 */
const SOCIAL_LINKS = [
  {
    label: 'Twitter',
    handle: '@Council15256',
    href: 'https://twitter.com/Council15256',
  },
  {
    label: 'Instagram',
    handle: 'kofc_15256',
    href: 'https://instagram.com/kofc_15256',
  },
  { label: 'Facebook', handle: null, href: 'https://www.facebook.com' },
];

/**
 * The copyright year is an unstable value, and `<Suspense>` does not fix those,
 * only uncached data. It is the same for every visitor and changes once a year,
 * so caching it is the right tool. `await connection()` would also silence the
 * error, but it would make the footer render per request and take every
 * marketing page's static shell down with it.
 */
async function getCopyrightYear() {
  'use cache';

  cacheLife('days');

  return new Date().getFullYear();
}

function FooterHeading(props: React.PropsWithChildren) {
  return (
    <h2 className="font-heading text-foreground text-sm font-semibold">
      {props.children}
    </h2>
  );
}

export async function SiteFooter() {
  const year = await getCopyrightYear();

  return (
    // `relative` is load-bearing, not decoration: `styles/makerkit.css` draws
    // the footer's top hairline as `.site-footer > .container::before` with
    // `position: absolute; top: 0`. With no positioned ancestor anywhere up the
    // tree it resolves against the initial containing block, so the hairline
    // paints at the top of the document instead of the top of the footer.
    <footer className="site-footer bg-muted/20 relative mt-auto w-full border-t py-10 xl:py-14">
      <div className="container">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-y-4">
            <AppLogo className="w-[150px]" sizes="150px" />

            <p className="text-muted-foreground text-sm">
              St. Louis Martin Council #15256 — Ashburn, Virginia
            </p>
          </div>

          <div className="flex flex-col gap-y-3">
            <FooterHeading>Quick Links</FooterHeading>

            <ul className="flex flex-col gap-y-1">
              {QUICK_LINKS.map((link) => (
                <li key={link.path}>
                  <Link
                    href={link.path}
                    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-y-3">
            <FooterHeading>Contact</FooterHeading>

            <address className="text-muted-foreground flex flex-col gap-y-1 text-sm not-italic">
              <span>Grand Knight: {GRAND_KNIGHT}</span>

              <a
                href={`mailto:${COUNCIL_EMAIL}`}
                className="hover:text-foreground break-words transition-colors"
              >
                {COUNCIL_EMAIL}
              </a>
            </address>

            <FooterHeading>Insurance Agent</FooterHeading>

            <address className="text-muted-foreground flex flex-col gap-y-1 text-sm not-italic">
              <span>{INSURANCE_AGENT.name}</span>

              <a
                href={`tel:${INSURANCE_AGENT.tel}`}
                className="hover:text-foreground transition-colors"
              >
                {INSURANCE_AGENT.phone}
              </a>

              <a
                href={`mailto:${INSURANCE_AGENT.email}`}
                className="hover:text-foreground break-words transition-colors"
              >
                {INSURANCE_AGENT.email}
              </a>
            </address>
          </div>

          <div className="flex flex-col gap-y-3">
            <FooterHeading>Follow Us</FooterHeading>

            <ul className="flex flex-col gap-y-1">
              {SOCIAL_LINKS.map((social) => (
                <li key={social.label}>
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                  >
                    {social.label}
                    {/*
                      The handle names the account, so it is content rather than
                      decoration and has to clear 4.5:1 at 14px. A `/70` opacity
                      modifier on `text-muted-foreground` measured 3.49:1 in
                      light and 3.52:1 in dark; inheriting the link's own colour
                      keeps it legible and makes it follow the hover state too.
                    */}
                    {social.handle ? <span> {social.handle}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="text-muted-foreground mt-10 flex flex-col gap-3 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} St. Louis Martin Council #15256 —{' '}
            <a
              href="https://www.kofc.org"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground transition-colors"
            >
              kofc.org
            </a>
          </p>

          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.map((link) => (
              <li key={link.path}>
                <Link
                  href={link.path}
                  className="hover:text-foreground transition-colors"
                >
                  <Trans i18nKey={link.i18nKey} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
