import type { Metadata } from 'next';

import appConfig from '~/config/app.config';

/**
 * Per-page metadata for the public marketing site.
 *
 * Every one of the 24 public routes used to ship the root layout's single
 * description and a single Open Graph card whose `og:url` was the site root, so
 * every link the council shared previewed identically and pointed at the
 * homepage. Sharing is the council's distribution channel, so that mattered
 * more here than on most sites.
 *
 * The helper exists because Next merges metadata *shallowly*: a page that sets
 * `openGraph` replaces the parent's `openGraph` object outright rather than
 * merging into it (see `generate-metadata.md`, "Merging"). So every page that
 * wants its own `og:title` also has to restate `siteName` and `type`, and
 * nineteen hand-written copies of those is exactly the kind of duplicated
 * constant this branch has had to fix twice already.
 *
 * `url` is passed root-relative and resolved against the root layout's
 * `metadataBase`, so the same call is correct in dev, in preview and in
 * production without reading an environment variable per page.
 *
 * Descriptions are condensed from each page's own copy -- not written as
 * marketing blurbs. This is a real parish's site; if a page's description is
 * not recognisable as that page's content, it is wrong.
 */
export function createPageMetadata({
  title,
  description,
  path,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  /**
   * Set `false` for a page that should not enter search results. Used only by
   * the three legal routes while they still render placeholder bodies.
   */
  index?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      type: 'website',
      siteName: appConfig.name,
      title,
      description,
      url: path,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}
