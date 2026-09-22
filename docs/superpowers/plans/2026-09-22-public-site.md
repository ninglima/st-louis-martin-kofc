# Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MakerKit marketing template with the council's real public site — 20 content pages, nested navigation, shared layout, assets, and a composed homepage — ported from the existing WordPress site.

**Architecture:** Content is MDX committed to the repo, where each `page.mdx` file *is* its route. A single `mdx-components.tsx` maps MDX elements onto the app's Tailwind design system, so all 20 pages inherit KofC styling, dark mode, and responsive behaviour without per-page styling. The homepage stays TSX because it composes four distinct sections rather than flowing prose.

**Tech Stack:** Next.js 16 (App Router, Turbopack), `@next/mdx` + `@mdx-js/loader` + `@mdx-js/react`, Tailwind v4, `@kit/ui` (Base UI), next-intl, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-public-site-design.md`

## Global Constraints

- **Source material** is the WordPress repo `github.com/ninglima/KofC-15256`. Clone it to a scratch directory; never commit it into this repo. Content lives at `specs/page-content/*.html`, images at `wordpress/wp-content/themes/kofc-15256/assets/images/`, brand files at `brand_assets/`, homepage structure at `wordpress/wp-content/themes/kofc-15256/front-page.php`.
- **Content fidelity is a hard requirement.** Names, email addresses, phone numbers, and meeting times must carry over exactly. HTML entities (`&#8217;`, `&#8212;`, `&amp;`) must be converted to real characters — a literal `&#8217;` in rendered output is a visible defect.
- **No page carries its own typography styles.** If a page needs custom styling, the `mdx-components.tsx` mapping is wrong. Fix the mapping.
- **Semantic Tailwind classes only** (`text-foreground`, `text-muted-foreground`, `bg-background`). Never hardcoded colours (`text-gray-500`, `bg-white`). This is what makes dark mode work.
- **Base UI, not Radix.** Never `asChild`; use the `render` prop. Import UI only as `@kit/ui/<name>`.
- `import * as z from 'zod'`, never `import { z }`. Never edit `packages/ui/src/shadcn/**`.
- `pnpm run typecheck` and `pnpm run lint` must both finish with **zero errors and zero warnings** before every commit.
- Commit format: `feat(site): <description>`. Stage only files you changed — never `git add -A` or `git add .`.
- **No database changes, no migrations, no auth changes.** Nothing under `apps/web/app/home/**` is modified; it is only linked to.

---

### Task 1: Wire up MDX and prove one page renders

MDX is currently a dead flag: `next.config.mjs` sets `experimental.mdxRs: true` and `@types/mdx` is installed, but `@next/mdx` and `@mdx-js/*` are absent and no `createMDX` wrapper exists. Nothing works until this task is done, and a misconfigured MDX pipeline **404s silently rather than erroring** — so this task ends by proving one real page renders in a browser.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.mjs`
- Create: `apps/web/mdx-components.tsx`
- Create: `apps/web/app/(marketing)/who-we-are/page.mdx`

**Interfaces:**
- Produces: a working `.mdx` route pipeline, and `useMDXComponents(components)` exported from `apps/web/mdx-components.tsx` — every later content task depends on both.

- [ ] **Step 1: Install the MDX packages**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
pnpm --filter web add @next/mdx @mdx-js/loader @mdx-js/react
```

The sandbox may deny `registry.npmjs.org` on the first attempt; re-run allowing that domain.

- [ ] **Step 2: Wire `createMDX` into the Next config**

`apps/web/next.config.mjs` currently ends with `export default withNextIntl(config);` on line 78. Two edits.

Add the import beside the existing next-intl import at the top:

```js
import createMDX from '@next/mdx';
```

Add `pageExtensions` to the `config` object, next to `reactStrictMode`:

```js
  pageExtensions: ['ts', 'tsx', 'mdx'],
```

Add `'.mdx'` to `turbopack.resolveExtensions` — it currently lists only `.ts`, `.tsx`, `.js`, `.jsx`, and Turbopack will not resolve `.mdx` routes without it:

```js
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx'],
  },
```

Replace the final export so both plugins compose. `withNextIntl` must remain the outermost wrapper:

```js
const withMDX = createMDX();

export default withNextIntl(withMDX(config));
```

Leave `experimental.mdxRs: true` alone — it is what makes `@next/mdx` use the Rust compiler, and it becomes meaningful now that the plugin exists.

- [ ] **Step 3: Create the MDX component mapping**

This file is the entire styling strategy. Create `apps/web/mdx-components.tsx`:

```tsx
import type { MDXComponents } from 'mdx/types';

import Link from 'next/link';

/**
 * Maps MDX elements onto the design system. Written once, inherited by every
 * .mdx page, which is what keeps the content pages free of their own
 * typography styles. Semantic colour tokens only, so dark mode works without
 * per-page effort.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="text-foreground mb-6 text-3xl font-bold tracking-tight lg:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-foreground mt-10 mb-4 text-2xl font-semibold tracking-tight">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-foreground mt-8 mb-3 text-xl font-semibold">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="text-muted-foreground mb-4 leading-7">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="text-muted-foreground mb-4 list-disc space-y-2 pl-6">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="text-muted-foreground mb-4 list-decimal space-y-2 pl-6">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-7">{children}</li>,
    strong: ({ children }) => (
      <strong className="text-foreground font-semibold">{children}</strong>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-border text-muted-foreground my-6 border-l-2 pl-6 italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border my-8" />,
    a: ({ href, children }) => {
      const url = href ?? '#';
      const isInternal = url.startsWith('/');

      if (isInternal) {
        return (
          <Link href={url} className="text-primary font-medium underline underline-offset-4">
            {children}
          </Link>
        );
      }

      const isExternalHttp = url.startsWith('http');

      return (
        <a
          href={url}
          className="text-primary font-medium underline underline-offset-4"
          {...(isExternalHttp
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {children}
        </a>
      );
    },
    ...components,
  };
}
```

Note `mailto:` links must NOT get `target="_blank"` — the `isExternalHttp` check above is what prevents that. Several content pages link to `kofc15256@googlegroups.com`.

- [ ] **Step 4: Create one real content page**

Clone the source repo to a scratch directory first:

```bash
cd "$TMPDIR" && rm -rf kofc-wp && gh repo clone ninglima/KofC-15256 kofc-wp -- --depth=1
cat "$TMPDIR/kofc-wp/specs/page-content/who-we-are.html"
```

Create `apps/web/app/(marketing)/who-we-are/page.mdx`, converting that HTML to Markdown. Convert every HTML entity to its real character. Start the file with metadata:

```mdx
export const metadata = {
  title: 'About Our Council',
};
```

Then the converted content — `<h2>` becomes `##`, `<h3>` becomes `###`, `<p>` becomes a plain paragraph, `<a href="x">y</a>` becomes `[y](x)`.

- [ ] **Step 5: Prove it renders in a browser**

This is the step that matters. A broken MDX pipeline 404s silently.

```bash
cd apps/web && pnpm exec dotenv -e ./.env.test -- next dev
```

Then fetch the page:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/who-we-are
```

Expected: `200`. If you get `404`, the MDX pipeline is misconfigured — recheck `pageExtensions`, `resolveExtensions`, and the plugin composition order before continuing. Do not proceed to Task 2 until this returns 200.

Also confirm the content actually rendered, not an empty shell:

```bash
curl -s http://localhost:3000/who-we-are | grep -c "Council"
```

Expected: a non-zero count.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
pnpm run typecheck
pnpm run lint
git add apps/web/package.json apps/web/next.config.mjs apps/web/mdx-components.tsx "apps/web/app/(marketing)/who-we-are/page.mdx" pnpm-lock.yaml
git commit -m "feat(site): wire up MDX and add the first content page"
```

---

### Task 2: Migrate images and brand assets

Doing this before the content pages means later tasks can reference images without a second pass.

**Files:**
- Create: `apps/web/public/images/**` (33 theme images)
- Create: `apps/web/public/images/brand/**` (KofC brand PNGs)

**Interfaces:**
- Produces: `/images/<subdir>/<name>` paths that content pages and homepage components reference.

- [ ] **Step 1: Copy theme images, preserving subdirectory grouping**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
mkdir -p apps/web/public/images
cp -R "$TMPDIR/kofc-wp/wordpress/wp-content/themes/kofc-15256/assets/images/." apps/web/public/images/
find apps/web/public/images -type f | wc -l
```

Expected: 33 files, in subdirectories such as `resources/` and `foster-children-support/`.

- [ ] **Step 2: Copy brand assets — PNG only**

The `.eps` files are print formats and must never enter a web bundle.

```bash
mkdir -p apps/web/public/images/brand
find "$TMPDIR/kofc-wp/brand_assets" -name "*.png" -exec cp {} apps/web/public/images/brand/ \;
ls apps/web/public/images/brand/
find apps/web/public/images -name "*.eps" | wc -l
```

Expected: PNGs present, and the `.eps` count is **0**. If any `.eps` slipped in, delete it.

- [ ] **Step 3: Check the total weight**

```bash
du -sh apps/web/public/images
find apps/web/public/images -type f -size +1M -exec ls -lh {} \; | awk '{print $9, $5}'
```

Record the total and any file over 1 MB in your report. Do not optimise them in this task, but flag anything unreasonably large so it can be dealt with deliberately.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/images
git commit -m "feat(site): add council images and KofC brand assets"
```

---

### Task 3: Navigation config and nested menus

The existing `site-navigation.tsx` holds a flat, empty link map with no second level. It needs one level of dropdown, driven by a single config array so navigation and routes cannot drift apart.

**Files:**
- Create: `apps/web/config/site-navigation.config.ts`
- Modify: `apps/web/app/(marketing)/_components/site-navigation.tsx`
- Test: `apps/web/config/site-navigation.config.test.ts`

**Interfaces:**
- Produces: `SITE_NAV: readonly NavItem[]` where
  `NavItem = { label: string; path?: string; children?: readonly NavChild[] }`
  and `NavChild = { label: string; path: string }`. Task 8's link-integrity test and the Playwright spec both consume `SITE_NAV`.

- [ ] **Step 1: Write the navigation config**

Create `apps/web/config/site-navigation.config.ts`:

```ts
export interface NavChild {
  label: string;
  path: string;
}

export interface NavItem {
  label: string;
  path?: string;
  children?: readonly NavChild[];
}

/**
 * Single source of truth for the public site's navigation. A link-integrity
 * test walks this array and asserts every path has a matching route file, so
 * a renamed page cannot silently 404.
 *
 * Deliberate deviations from the WordPress site, all recorded in the spec:
 * "News" is omitted (no content, empty on the live site), "Grand Knight" is
 * omitted (its copy lives in the homepage welcome section), and "Pay Dues"
 * points at the working checkout rather than repeating the old
 * "coming soon" copy.
 */
export const SITE_NAV: readonly NavItem[] = [
  { label: 'Home', path: '/' },
  {
    label: 'Who We Are',
    children: [
      { label: 'About Our Council', path: '/who-we-are' },
      { label: 'Council Leadership', path: '/council-leadership' },
    ],
  },
  {
    label: 'Faith In Action',
    children: [
      { label: 'Right to Life', path: '/faith-in-action/right-to-life' },
      { label: 'Foster Children Support', path: '/faith-in-action/foster-children-support' },
      { label: 'Loudoun Food Pantry', path: '/faith-in-action/food-pantry' },
      { label: 'Breakfast with the Knights', path: '/faith-in-action/breakfast-with-knights' },
      { label: 'Handy Man Services', path: '/faith-in-action/handy-man-services' },
      { label: 'Honor Flights', path: '/faith-in-action/honor-flights' },
      { label: 'Seminarian Bios', path: '/faith-in-action/seminarian-bios' },
    ],
  },
  { label: 'Events', path: '/events' },
  { label: 'Catholic Resources', path: '/catholic-resources' },
  {
    label: 'Get Involved',
    children: [
      { label: 'Membership', path: '/get-involved/membership' },
      { label: 'Fraternal Benefits', path: '/get-involved/fraternal-benefits' },
      { label: 'Pay Dues', path: '/get-involved/pay-dues' },
      { label: 'Shirt Order', path: '/get-involved/shirt-order' },
      { label: 'Contact', path: '/get-involved/contact' },
      { label: 'FAQs', path: '/faq' },
    ],
  },
] as const;
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/config/site-navigation.config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { SITE_NAV } from './site-navigation.config';

describe('SITE_NAV', () => {
  it('gives every item either a path or children, never neither', () => {
    for (const item of SITE_NAV) {
      expect(Boolean(item.path) || Boolean(item.children?.length)).toBe(true);
    }
  });

  it('uses root-relative paths everywhere', () => {
    const paths = SITE_NAV.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ?? []).map((child) => child.path),
    ]);

    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
    }
  });

  it('contains no duplicate paths', () => {
    const paths = SITE_NAV.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ?? []).map((child) => child.path),
    ]);

    expect(new Set(paths).size).toBe(paths.length);
  });
});
```

`apps/web` has no `test:unit` script yet. Add one to `apps/web/package.json` scripts, matching the sibling packages:

```json
    "test:unit": "vitest run",
```

and add `"vitest": "catalog:"` to its `devDependencies`.

- [ ] **Step 3: Run the test**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
pnpm install
pnpm --filter web test:unit
```

Expected: 3 tests pass. (This config is data, so the test is a guard against future edits rather than a red-green cycle.)

- [ ] **Step 4: Rewrite the navigation component**

Replace `apps/web/app/(marketing)/_components/site-navigation.tsx` so it renders `SITE_NAV`. Requirements:

- Desktop: top-level items with no children render as links; items with children render a `NavigationMenu` trigger plus a content panel listing the children.
- Mobile: the existing `DropdownMenu` pattern, with children rendered indented beneath their parent label.
- Use `@kit/ui/navigation-menu` and `@kit/ui/dropdown-menu`, both already imported by the current file.
- **Base UI, not Radix** — never `asChild`; use `render={<Link href={...} />}`, which is the pattern the current file already uses in `MobileDropdown`.
- `data-test="site-nav-desktop"` and `data-test="site-nav-mobile"` on the two containers; `data-test={'nav-link-' + path}` on each link.
- Labels are plain English strings from the config, not i18n keys — the public site copy is not translated, and inventing keys for it would add a namespace with one locale.

- [ ] **Step 5: Verify in a browser**

With the dev server running, confirm the nav renders and a dropdown child is reachable:

```bash
curl -s http://localhost:3000/ | grep -c "Faith In Action"
```

Expected: non-zero.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm run typecheck
pnpm run lint
pnpm --filter web test:unit
git add apps/web/config/site-navigation.config.ts apps/web/config/site-navigation.config.test.ts "apps/web/app/(marketing)/_components/site-navigation.tsx" apps/web/package.json pnpm-lock.yaml
git commit -m "feat(site): add navigation config with nested menus"
```

---

### Task 4: Port the Who We Are and Faith In Action pages

Nine pages. Mechanical, but fidelity matters — these describe real services and name real people.

**Files:**
- Create: `apps/web/app/(marketing)/council-leadership/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/right-to-life/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/foster-children-support/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/food-pantry/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/breakfast-with-knights/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/handy-man-services/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/honor-flights/page.mdx`
- Create: `apps/web/app/(marketing)/faith-in-action/seminarian-bios/page.mdx`

**Interfaces:**
- Consumes: the MDX pipeline and `useMDXComponents` from Task 1.

- [ ] **Step 1: Convert each source file**

For each page, read the source and convert it:

```bash
cat "$TMPDIR/kofc-wp/specs/page-content/council-leadership.html"
```

Source-to-route mapping:

| Source file | Route |
| --- | --- |
| `council-leadership.html` | `/council-leadership` |
| `faith-in-action.html` | `/faith-in-action` |
| `right-to-life.html` | `/faith-in-action/right-to-life` |
| `foster-children-support.html` | `/faith-in-action/foster-children-support` |
| `food-pantry.html` | `/faith-in-action/food-pantry` |
| `breakfast-with-knights.html` | `/faith-in-action/breakfast-with-knights` |
| `handy-man-services.html` | `/faith-in-action/handy-man-services` |
| `honor-flights.html` | `/faith-in-action/honor-flights` |
| `seminarian-bios.html` | `/faith-in-action/seminarian-bios` |

Each file begins with metadata whose `title` matches the navigation label:

```mdx
export const metadata = {
  title: 'Council Leadership',
};
```

Conversion rules:
- `<h2>` → `##`, `<h3>` → `###`, `<p>` → plain paragraph, `<ul><li>` → `-` list
- `<strong>` → `**bold**`
- `<a href="x">y</a>` → `[y](x)`
- **Every HTML entity becomes a real character:** `&#8217;` → `'`, `&#8212;` → `—`, `&#8211;` → `–`, `&amp;` → `&`
- Keep email addresses and phone numbers exactly as written

- [ ] **Step 2: Check for leftover entities across all pages**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
grep -rn "&#[0-9]\{4\}\|&amp;\|&quot;\|&nbsp;" "apps/web/app/(marketing)" --include="*.mdx" || echo "CLEAN — no entities remain"
```

Expected: `CLEAN`. Any hit is a visible defect on the rendered page.

- [ ] **Step 3: Verify every route responds**

```bash
for p in council-leadership faith-in-action faith-in-action/right-to-life faith-in-action/foster-children-support faith-in-action/food-pantry faith-in-action/breakfast-with-knights faith-in-action/handy-man-services faith-in-action/honor-flights faith-in-action/seminarian-bios; do
  printf "%s -> " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/$p"
done
```

Expected: `200` for all nine.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
pnpm run typecheck
pnpm run lint
git add "apps/web/app/(marketing)/council-leadership" "apps/web/app/(marketing)/faith-in-action"
git commit -m "feat(site): add Who We Are and Faith In Action pages"
```

---

### Task 5: Port the Get Involved pages, Events, Catholic Resources, and FAQ

Ten pages, including the one that needs rewriting rather than porting.

**Files:**
- Create: `apps/web/app/(marketing)/get-involved/page.mdx`
- Create: `apps/web/app/(marketing)/get-involved/membership/page.mdx`
- Create: `apps/web/app/(marketing)/get-involved/fraternal-benefits/page.mdx`
- Create: `apps/web/app/(marketing)/get-involved/pay-dues/page.mdx`
- Create: `apps/web/app/(marketing)/get-involved/shirt-order/page.mdx`
- Create: `apps/web/app/(marketing)/get-involved/contact/page.mdx`
- Create: `apps/web/app/(marketing)/events/page.mdx`
- Create: `apps/web/app/(marketing)/master-calendar/page.mdx`
- Create: `apps/web/app/(marketing)/catholic-resources/page.mdx`
- Modify: `apps/web/app/(marketing)/faq/page.tsx`

- [ ] **Step 1: Port the straightforward pages**

Same conversion rules as Task 4.

| Source file | Route |
| --- | --- |
| `get-involved.html` | `/get-involved` |
| `membership.html` | `/get-involved/membership` |
| `fraternal-benefits.html` | `/get-involved/fraternal-benefits` |
| `shirt-order.html` | `/get-involved/shirt-order` |
| `contact.html` | `/get-involved/contact` |
| `events.html` | `/events` |
| `master-calendar.html` | `/master-calendar` |
| `catholic-resources.html` | `/catholic-resources` |

`events.html` is a static list of meeting times and dated activities, not a calendar system — port it as prose. At the end of the Events page, add a link to the master calendar, since `/master-calendar` is intentionally absent from the navigation and would otherwise be unreachable:

```mdx
The council's [master calendar](/master-calendar) lists scheduling information for the fraternal year.
```

- [ ] **Step 2: Rewrite Pay Dues — do not port it**

The source says *"Online dues payment is coming soon. To pay your annual council dues by check, please contact the council treasurer."* That is now false: the app has a working checkout. Porting it verbatim would ship a page telling members a feature does not exist when it does.

Create `apps/web/app/(marketing)/get-involved/pay-dues/page.mdx`:

```mdx
export const metadata = {
  title: 'Pay Council Dues',
};

## Pay Council Dues

Members can pay their annual council dues online by credit or debit card. [Sign in to your account](/auth/sign-in) to pay dues and view your payment history.

### Paying by Check

If you would prefer to pay by check, please contact the council treasurer at [kofc15256@googlegroups.com](mailto:kofc15256@googlegroups.com).
```

Link to `/auth/sign-in` rather than `/home/checkout` directly — an unauthenticated visitor hitting the checkout is bounced to sign-in anyway, and this way the journey reads deliberately.

- [ ] **Step 3: Move the FAQ content into the existing page**

`apps/web/app/(marketing)/faq/page.tsx` already exists as a template page. Read `faqs.html` — it is the largest source file at 4.6 KB — and replace the page's placeholder body with that content. Keep the existing `SitePageHeader` and metadata pattern the file already uses; only the body changes. If the content is a list of question/answer pairs, render it with the same heading and paragraph structure the MDX mapping uses so it is visually consistent with the MDX pages.

- [ ] **Step 4: Check entities and verify routes**

```bash
grep -rn "&#[0-9]\{4\}\|&amp;\|&quot;\|&nbsp;" "apps/web/app/(marketing)" --include="*.mdx" || echo "CLEAN"

for p in get-involved get-involved/membership get-involved/fraternal-benefits get-involved/pay-dues get-involved/shirt-order get-involved/contact events master-calendar catholic-resources faq; do
  printf "%s -> " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/$p"
done
```

Expected: `CLEAN`, and `200` for all ten.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm run typecheck
pnpm run lint
git add "apps/web/app/(marketing)/get-involved" "apps/web/app/(marketing)/events" "apps/web/app/(marketing)/master-calendar" "apps/web/app/(marketing)/catholic-resources" "apps/web/app/(marketing)/faq"
git commit -m "feat(site): add Get Involved, Events, Catholic Resources and FAQ content"
```

---

### Task 6: Homepage

Four sections composed in TSX. Section order follows `front-page.php`, not the older design doc — the template is what actually ships today.

**Files:**
- Modify: `apps/web/app/(marketing)/page.tsx`
- Create: `apps/web/app/(marketing)/_components/home-gk-welcome.tsx`
- Create: `apps/web/app/(marketing)/_components/home-member-join-split.tsx`
- Create: `apps/web/app/(marketing)/_components/home-stats-bar.tsx`
- Create: `apps/web/app/(marketing)/_components/home-insurance-resources.tsx`

- [ ] **Step 1: Extract the Grand Knight's message**

The message body lives in a WordPress page at `/gk-message/` and is **not** in the repo export. Get it from the live site:

```bash
curl -s https://kofc-15256.org/ | sed -n '/kofc-gk-message/,/kofc-gk-signature/p'
```

Copy it **verbatim**. Do not paraphrase, shorten, or "improve" it — it is a named person's signed message. If the markup makes extraction unreliable, stop and report that you need the copy provided rather than inventing it.

- [ ] **Step 2: Build the Grand Knight welcome section**

`home-gk-welcome.tsx`. A two-column layout: photo and council identity on one side, message on the other. Contents, from `front-page.php`:

- The eyebrow "A Message from Our Grand Knight"
- The message body from Step 1
- The signature "— Steve Shields, Grand Knight"
- The council emblem from `/images/brand/` via `next/image`

If no Grand Knight photograph exists in the migrated assets, render the council emblem alone rather than a broken image or an empty placeholder box, and note it in your report.

- [ ] **Step 3: Build the member/join split**

`home-member-join-split.tsx`. Two cards side by side, from `front-page.php`:

| Card | Body | Action |
| --- | --- | --- |
| I'm a Member | brief member-portal description | "Go to My Account" → `/home` |
| I Want to Join | brief recruitment description | "Answer the Call to Serve" → `/get-involved/membership` |

Use `@kit/ui/card` and `@kit/ui/button`. Buttons that navigate use `render={<Link href={...} />}` — never `asChild`. Add `data-test="home-member-cta"` and `data-test="home-join-cta"`.

- [ ] **Step 4: Build the stats bar**

`home-stats-bar.tsx`. Three figures, static, with descriptions from `specs/site-copy/metrics.md`:

```tsx
const STATS = [
  {
    value: '372',
    label: 'Brother Knights',
    description: 'Number of Brother Knights in our Council — and growing!',
  },
  {
    value: '64,165',
    label: 'Pounds of Food Donated',
    description:
      'Pounds of food donated by St. Theresa Parishioners and delivered by the Knights in 2025-2026 Fraternal Year to the Sterling Catholic Charities Food Pantry',
  },
  {
    value: '$15,000',
    label: 'Raised for KOVAR',
    description:
      'Amount of money raised for KOVAR in the 2025-2026 Fraternal Year - a Knights of Columbus charity that assists our brothers and sisters with intellectual disabilities.',
  },
] as const;
```

The WordPress version animates these counting up. Do not reimplement that — it needs client-side JS for decoration and the numbers read fine static.

- [ ] **Step 5: Build the insurance and resources section**

`home-insurance-resources.tsx`. Bill Lupinacci, Abbate Agency, `703-624-9687`, `bill.lupinacci@kofc.org`. Render the phone as a `tel:` link and the email as a `mailto:` link. Include a link to `/catholic-resources`.

- [ ] **Step 6: Compose the homepage**

Replace the body of `apps/web/app/(marketing)/page.tsx` with the four sections in order: welcome, member/join split, stats, insurance and resources. Keep whatever layout wrapper the existing file uses. Do **not** add News, Newsletter, or Current Initiatives sections — they are deliberately omitted.

- [ ] **Step 7: Verify in a browser**

```bash
curl -s http://localhost:3000/ | grep -c "Grand Knight"
curl -s http://localhost:3000/ | grep -c "64,165"
```

Expected: non-zero for both.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm run typecheck
pnpm run lint
git add "apps/web/app/(marketing)/page.tsx" "apps/web/app/(marketing)/_components"
git commit -m "feat(site): rebuild the homepage from council content"
```

---

### Task 7: Footer

**Files:**
- Modify: `apps/web/app/(marketing)/_components/site-footer.tsx`

- [ ] **Step 1: Rewrite the footer**

Read the current file first — it is MakerKit template scaffolding, so expect to replace rather than extend its contents. It must carry:

- Council name and Grand Knight Steve Shields
- `kofc15256@googlegroups.com` as a `mailto:` link
- Insurance agent block: Bill Lupinacci, 703-624-9687, `bill.lupinacci@kofc.org`
- Social links (Twitter, Instagram, Facebook) if the live site's URLs can be determined; omit any whose URL you cannot confirm rather than guessing
- A copyright line

Drop the GeneratePress attribution — it refers to the WordPress theme and does not apply here.

- [ ] **Step 2: Verify and commit**

```bash
curl -s http://localhost:3000/ | grep -c "kofc15256@googlegroups.com"
pnpm run typecheck
pnpm run lint
git add "apps/web/app/(marketing)/_components/site-footer.tsx"
git commit -m "feat(site): replace footer with council contact details"
```

---

### Task 8: Link integrity test and end-to-end coverage

The one test genuinely worth writing here. Prose pages do not need unit tests; a broken link does need catching.

**Files:**
- Create: `apps/web/config/site-navigation.routes.test.ts`
- Create: `apps/e2e/tests/public-site/public-site.spec.ts`

**Interfaces:**
- Consumes: `SITE_NAV` from Task 3.

- [ ] **Step 1: Write the link-integrity test**

Every navigation path must have a real route file, so a renamed page cannot silently 404. Create `apps/web/config/site-navigation.routes.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SITE_NAV } from './site-navigation.config';

const MARKETING_DIR = join(__dirname, '..', 'app', '(marketing)');

/**
 * Routes that live outside the (marketing) group or are not .mdx pages.
 * Each needs its own existence check rather than the generic one below.
 */
const SPECIAL_CASES: Record<string, string> = {
  '/': join(MARKETING_DIR, 'page.tsx'),
  '/faq': join(MARKETING_DIR, 'faq', 'page.tsx'),
};

function routeFileFor(path: string): string {
  if (SPECIAL_CASES[path]) {
    return SPECIAL_CASES[path];
  }

  return join(MARKETING_DIR, ...path.slice(1).split('/'), 'page.mdx');
}

describe('navigation link integrity', () => {
  const paths = SITE_NAV.flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.children ?? []).map((child) => child.path),
  ]);

  it.each(paths)('has a route file for %s', (path) => {
    expect(existsSync(routeFileFor(path))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
pnpm --filter web test:unit
```

Expected: every navigation path passes. A failure names the exact missing route file.

- [ ] **Step 3: Write the Playwright spec**

Create `apps/e2e/tests/public-site/public-site.spec.ts`. Read `apps/e2e/tests/rbac/rbac.spec.ts` first for the house conventions. The spec must:

- Visit every path in `SITE_NAV` (import the config directly rather than duplicating the list) plus `/master-calendar`, and assert each returns a page with a visible `h1` or `h2`.
- Assert no page renders a raw HTML entity — search the body text for `&#` and expect no match.
- Exercise the mobile navigation: set a narrow viewport, open the mobile menu, and confirm a nested child link (for example "Right to Life") is reachable.

These tests need no authentication — the public site is not gated.

- [ ] **Step 4: Run the e2e spec**

The suite needs a local Supabase stack and a dev server. Docker is available on this machine, but **the sandbox blocks the Docker socket**, so use `dangerouslyDisableSandbox: true` for docker, supabase and playwright commands.

```bash
cd apps/web && supabase start
cd ../e2e && pnpm exec playwright test tests/public-site --reporter=line --workers=1
```

Expected: all pass. If a route 404s, the navigation config and the route files have drifted — fix the mismatch rather than removing the assertion.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd /Users/nick/PycharmProjects/st-louis-martin-kofc
pnpm run typecheck
pnpm run lint
git add apps/web/config/site-navigation.routes.test.ts apps/e2e/tests/public-site
git commit -m "test(site): add link-integrity and public-site e2e coverage"
```

---

### Task 9: Visual comparison against the live site

The plan's final gate. Everything before this proves the pages exist; this checks they read correctly.

**Files:** none (verification only, unless defects are found)

- [ ] **Step 1: Walk every page side by side**

With the dev server running, open each route alongside its counterpart on <https://kofc-15256.org/> and compare. Use the `playwright-chromium` MCP browser tools.

For each page, check:
- All content present — no dropped paragraphs, list items, or links
- Names, email addresses, phone numbers and meeting times match exactly
- No raw HTML entities rendered anywhere
- Headings form a sensible hierarchy
- Links resolve: internal ones navigate, `mailto:` links carry the right address, external ones open in a new tab

- [ ] **Step 2: Check responsive behaviour and dark mode**

Resize to a mobile viewport and confirm the navigation collapses, nested items are reachable, and no content overflows horizontally. Toggle dark mode and confirm text stays legible everywhere — any hardcoded colour will show up here as unreadable text.

- [ ] **Step 3: Report**

Write up what matched, anything that differs deliberately (the three navigation deviations and the rewritten Pay Dues page), and any defect found. Fix defects in this task and commit them; escalate anything that needs a content decision rather than guessing.

```bash
pnpm run typecheck && pnpm run lint
git add -u && git commit -m "fix(site): corrections from visual comparison"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: MDX wiring → 1; `mdx-components.tsx` → 1; routes → 1, 4, 5; navigation and its three deviations → 3 (config) and 5 (Pay Dues rewrite); homepage → 6; assets → 2; footer → 7; testing → 8; manual comparison → 9. The `master-calendar` orphan is handled in Task 5 Step 1 by linking it from Events.

**Deliberate ordering.** Task 1 ends by proving a page renders in a browser because a misconfigured MDX pipeline 404s silently — discovering that after porting twenty pages would waste the lot. Assets come before content so pages can reference images without a second pass.

**Known risk.** The Grand Knight's message is not in the repo export and must be scraped from the live site. If extraction proves unreliable, Task 6 Step 1 says to stop and ask rather than invent a named person's words.
