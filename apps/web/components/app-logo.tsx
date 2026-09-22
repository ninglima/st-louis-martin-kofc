import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@kit/ui/utils';

const LOGO_SRC_LIGHT = '/images/brand/kofc_r_hz_rgb_pos.png';
const LOGO_SRC_DARK = '/images/brand/kofc_r_hz_rgb_rev.png';

/**
 * The council's horizontal Knights of Columbus lockup, replacing the MakerKit
 * wordmark that shipped with the template.
 *
 * Two variants are rendered and swapped with `dark:` classes, the same pattern
 * as the homepage emblem in `app/(marketing)/_components/home-gk-welcome.tsx`.
 * The positive mark is drawn in navy ink and disappears against a dark
 * background; the reversed mark is white and disappears against a light one.
 * Which one paints is a CSS decision, so neither carries `priority` (Next
 * cannot know at preload time which variant the theme will reveal, and
 * preloading the wrong one is strictly worse than preloading neither).
 *
 * `alt=""` on both: the mark is announced once by the wrapping link's
 * `aria-label`, and duplicating that on two images that are both in the DOM
 * would announce the brand twice to a screen reader. Where the logo is
 * unlinked it sits beside text that already names the council.
 *
 * `width`/`height` are the PNGs' real intrinsic pixels (1160x540) so the
 * layout reserves the correct box and nothing shifts as the image decodes.
 *
 * `eager` opts out of lazy loading for the header instance, which sits above
 * the fold on every route and is the page's LCP element; left lazy, Next warns
 * about it. It is deliberately `loading="eager"` rather than `priority`:
 * `priority` would also emit a `<link rel="preload">` for a variant the theme
 * may never reveal, which is the failure mode the homepage emblem documents.
 */
function LogoImage({
  className,
  sizes = '104px',
  eager = false,
}: {
  className?: string;
  sizes?: string;
  eager?: boolean;
}) {
  const shared = cn('h-auto w-[104px]', className);
  const loading = eager ? 'eager' : 'lazy';

  return (
    <>
      <Image
        src={LOGO_SRC_LIGHT}
        alt=""
        width={1160}
        height={540}
        sizes={sizes}
        loading={loading}
        className={cn(shared, 'dark:hidden')}
      />

      <Image
        src={LOGO_SRC_DARK}
        alt=""
        width={1160}
        height={540}
        sizes={sizes}
        loading={loading}
        className={cn(shared, 'hidden dark:block')}
      />
    </>
  );
}

export function AppLogo({
  href,
  label,
  className,
  sizes,
  eager,
}: {
  href?: string | null;
  className?: string;
  label?: string;
  sizes?: string;
  eager?: boolean;
}) {
  if (href === null) {
    return <LogoImage className={className} sizes={sizes} eager={eager} />;
  }

  return (
    <Link aria-label={label ?? 'Home Page'} href={href ?? '/'}>
      <LogoImage className={className} sizes={sizes} eager={eager} />
    </Link>
  );
}
