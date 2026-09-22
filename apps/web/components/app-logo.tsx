import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@kit/ui/utils';

const LOGO_SRC_LIGHT = '/images/brand/kofc_r_hz_rgb_pos.png';
const LOGO_SRC_DARK = '/images/brand/kofc_r_hz_rgb_rev.png';

const EMBLEM_SRC_LIGHT = '/images/brand/kofc_r_emblem_rgb_pos.png';
const EMBLEM_SRC_DARK = '/images/brand/kofc_r_emblem_rgb_rev.png';

/**
 * Renders both variants of a Knights of Columbus mark and lets CSS pick one:
 * the positive artwork is navy ink and vanishes on a dark background, the
 * reversed artwork is white and vanishes on a light one. The choice is a
 * `dark:` class rather than a `useTheme()` read, so the server renders both and
 * there is no hydration mismatch and no flash of the wrong mark.
 *
 * `alt=""` on both: the mark is announced once by the wrapping link's
 * `aria-label`, and duplicating that on two images that are both in the DOM
 * would announce the brand twice to a screen reader. Where the mark is unlinked
 * it sits beside text that already names the council.
 *
 * `width`/`height` are the PNGs' real intrinsic pixels so the layout reserves
 * the correct box and nothing shifts as the image decodes.
 *
 * `eager` opts out of lazy loading for the header instance, which sits above
 * the fold on every route and is the page's LCP element. Next's dev-only LCP
 * warning fires exactly when the LCP image has `loading === 'lazy'`
 * (`next/dist/shared/lib/get-img-props.js`), and `loading="eager"` is the fix
 * that warning itself names.
 *
 * Each image is wrapped in its own `<picture>`. That is not for art direction:
 * React 19's Float logic emits a `<link rel="preload" as="image">` for every
 * non-lazy `<img>` it renders, which measurably preloaded *both* header
 * variants on all 24 routes and fetched the theme-invisible one at preload
 * priority, in direct contention with the mark that is actually the LCP
 * element. React skips that preload when the `<img>` is inside a `<picture>`
 * or `<noscript>` (`react-dom-server`: `tagScope & 3` in the `case 'img'`
 * branch), which is the only lever available here because the theme is a
 * client-side class and the server cannot know which variant will paint.
 * `display: contents` keeps the wrapper out of layout entirely.
 *
 * What this does NOT do: the hidden variant is still fetched. Chrome requests
 * a `display: none` image either way - measured on `/faq` at scrollY 0, the
 * footer's lazy *and* hidden variant is requested alongside the visible one -
 * so no `loading` value avoids the wrong-theme bytes while the theme is decided
 * in CSS. What the `<picture>` wrapper removes is the preload link and its
 * scanner priority, not the request itself.
 */
function ThemedMark({
  lightSrc,
  darkSrc,
  width,
  height,
  baseClassName,
  className,
  sizes,
  eager = false,
}: {
  lightSrc: string;
  darkSrc: string;
  width: number;
  height: number;
  baseClassName: string;
  className?: string;
  sizes: string;
  eager?: boolean;
}) {
  const shared = cn(baseClassName, className);
  const loading = eager ? 'eager' : 'lazy';

  return (
    <>
      <picture className={'contents'}>
        <Image
          src={lightSrc}
          alt=""
          width={width}
          height={height}
          sizes={sizes}
          loading={loading}
          className={cn(shared, 'dark:hidden')}
        />
      </picture>

      <picture className={'contents'}>
        <Image
          src={darkSrc}
          alt=""
          width={width}
          height={height}
          sizes={sizes}
          loading={loading}
          className={cn(shared, 'hidden dark:block')}
        />
      </picture>
    </>
  );
}

function LogoImage({
  className,
  sizes = '104px',
  eager = false,
}: {
  className?: string;
  sizes?: string;
  eager?: boolean;
}) {
  return (
    <ThemedMark
      lightSrc={LOGO_SRC_LIGHT}
      darkSrc={LOGO_SRC_DARK}
      width={1160}
      height={540}
      baseClassName={'h-auto w-[104px]'}
      className={className}
      sizes={sizes}
      eager={eager}
    />
  );
}

/**
 * The council's horizontal Knights of Columbus lockup, replacing the MakerKit
 * wordmark that shipped with the template.
 */
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

/**
 * The square emblem, for slots too narrow to read the horizontal lockup. The
 * collapsed icon sidebar is 3rem wide, which leaves the lockup about 31px
 * across and 14.5px tall: an illegible smudge of an emblem plus two lines of
 * type. The emblem alone is 450x450, so the same 28px box gives it roughly four
 * times the area.
 *
 * Always unlinked: every current slot is already inside a link, and nesting
 * anchors is invalid.
 */
export function AppEmblem({
  className,
  sizes = '28px',
}: {
  className?: string;
  sizes?: string;
}) {
  return (
    <ThemedMark
      lightSrc={EMBLEM_SRC_LIGHT}
      darkSrc={EMBLEM_SRC_DARK}
      width={450}
      height={450}
      baseClassName={'h-auto w-7'}
      className={className}
      sizes={sizes}
    />
  );
}
