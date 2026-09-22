# Public Site — Design

**Date:** 2026-09-22
**Status:** Approved for planning

## Goal

Replace the MakerKit marketing template with the council's real public site,
porting content and layout from the existing WordPress site at
<https://kofc-15256.org/>.

Source material lives in `github.com/ninglima/KofC-15256`:

- `specs/page-content/*.html` — 20 pages of clean semantic HTML, already
  extracted from WordPress. Not block soup; `h2`/`h3`/`p`/`ul`/`a` only.
- `specs/site-copy/metrics.md` — the stats-bar descriptions.
- `wordpress/wp-content/themes/kofc-15256/assets/images/` — 33 images.
- `brand_assets/` — official KofC logo files.
- `wordpress/wp-content/themes/kofc-15256/front-page.php` — homepage structure.

## Scope

This spec covers the public site only: content pages, navigation, shared
layout, assets, and the homepage.

**Explicitly out of scope**, each deferred to its own spec:

| Deferred | Why |
| --- | --- |
| News / announcements | Empty on the live site; needs an authoring story, which is a CMS |
| Council newsletter | Same, plus PDF upload |
| Events system | The WP site runs The Events Calendar + Event Tickets; a real subsystem |
| Membership & dues | Levels, paid-through state, manual payment recording |
| Roster import | Bulk import from Officers Online Contact Extract |

The only dependency between this spec and the rest of the app is the
"Pay Dues" navigation entry, which links to the existing `/home/checkout`.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Content storage | MDX files in the repo | Content changes rarely (leadership names, service descriptions). No database, no CMS, versioned in git. The cost — an officer cannot fix a typo without a developer — is accepted. |
| Routing | `page.mdx` files *are* the routes | The pages have no per-page logic, so a content directory plus a catch-all route buys nothing but machinery. This is the approach Next's own MDX documentation describes. |
| Visual treatment | Match WordPress layout, restyle with the design system | The public site and member portal then read as one product, and dark mode and responsive behaviour come for free. Will not be pixel-identical to today's site. |
| Empty homepage sections | Omitted | News, Newsletter and Initiatives are empty or unpublished on the live site. A homepage with no empty shells reads as finished rather than half-built. |
| Stats values | Static, in the homepage component | Three integers that change a few times a year. A table, migration, RLS policy and admin form for three numbers is disproportionate. |

## MDX is not currently wired up

`apps/web/next.config.mjs` sets `mdxRs: true` and `@types/mdx` is installed,
but there are **no `.mdx` files, no `createMDX` wrapper, and neither
`@next/mdx` nor `@mdx-js/*` is installed.** The flag alone does nothing.

Standing MDX up is therefore part of this work:

- Add `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`.
- Wrap the config with `createMDX()` and set
  `pageExtensions: ['ts', 'tsx', 'mdx']`.
- Create `apps/web/mdx-components.tsx`.

## `mdx-components.tsx` is the whole styling strategy

One file maps MDX elements to design-system components:

```
h2 h3 h4 → styled headings
p ul ol li → prose with council spacing
a → next/link for internal, plain anchor for external
strong em blockquote hr
```

Written once, inherited by all 20 pages. This is what makes "match layout,
restyle with the design system" cheap rather than 20 hand-styled pages. No
page should carry its own typography styles; if one needs to, the mapping is
wrong.

Use semantic Tailwind classes only (`text-foreground`,
`text-muted-foreground`), never hardcoded colours, so dark mode works
without per-page effort.

## Routes

```
apps/web/app/(marketing)/
  page.tsx                              homepage (composed, stays TSX)
  who-we-are/page.mdx
  council-leadership/page.mdx
  faith-in-action/
    page.mdx
    right-to-life/page.mdx
    foster-children-support/page.mdx
    food-pantry/page.mdx
    breakfast-with-knights/page.mdx
    handy-man-services/page.mdx
    honor-flights/page.mdx
    seminarian-bios/page.mdx
  events/page.mdx
  catholic-resources/page.mdx
  get-involved/
    page.mdx
    membership/page.mdx
    fraternal-benefits/page.mdx
    pay-dues/page.mdx
    shirt-order/page.mdx
    contact/page.mdx
  master-calendar/page.mdx
```

Already present and reused: `/faq` (takes the `faqs.html` content), the legal
pages, and `/auth/sign-in` for Member Login.

Every one of the 20 extracted HTML files maps to exactly one route above,
except `faqs.html`, which fills the existing `/faq` page. Two mappings are
not obvious from the filename:

- `who-we-are.html` → `/who-we-are`, which the navigation labels
  "About Our Council".
- `master-calendar.html` → `/master-calendar`, which is **not** in the
  navigation, matching the live site. It is a placeholder page ("the council
  master calendar will be available here"), so it is linked from the Events
  page rather than left unreachable. Creating an orphan route nothing links
  to would be worse than either linking or omitting it.

## Navigation

`apps/web/app/(marketing)/_components/site-navigation.tsx` currently holds a
flat, empty link map with no support for a second level. It must be extended
to one level of dropdown, driven by a single config array so that navigation
and routes cannot drift apart.

| Item | Children |
| --- | --- |
| Home | — |
| Who We Are | About Our Council, Council Leadership |
| Faith In Action | Right to Life, Foster Children Support, Loudoun Food Pantry, Breakfast with the Knights, Handy Man Services, Honor Flights, Seminarian Bios |
| Events | — |
| Catholic Resources | — |
| Get Involved | Membership, Fraternal Benefits, Pay Dues, Shirt Order, Contact, FAQs |
| Member Login | — (links to `/auth/sign-in`) |

Desktop uses `@kit/ui/navigation-menu`; mobile extends the existing dropdown
to nest children.

### Three deliberate deviations from the live site

1. **News is dropped from the navigation.** No content exists for it and the
   section is empty on the live site. It returns with the news spec.
2. **Grand Knight is dropped as a standalone page.** There is no
   `gk-message.html` in the export; that copy belongs to the homepage
   welcome section. Shipping an empty page would be worse than omitting it.
3. **Pay Dues is rewritten, not ported.** The existing copy reads *"Online
   dues payment is coming soon. To pay your annual council dues by check,
   please contact the council treasurer."* That is now false — the app has a
   working checkout. The page must instead point members at
   `/home/checkout`, and keep the check-payment path as the alternative.

## Homepage

Four sections, matching the order in `front-page.php`, each a small
component in `app/(marketing)/_components/`:

1. **Grand Knight welcome** — photo, council identity block, the eyebrow
   "A Message from Our Grand Knight", the message body, and the signature
   "— Steve Shields, Grand Knight".
2. **Member / Join split** — two cards. "I'm a Member" → *Go to My Account*
   (`/home`). "I Want to Join" → *Answer the Call to Serve*
   (`/get-involved/membership`).
3. **Stats bar** — 372 Brother Knights, 64,165 pounds of food donated,
   $15,000 raised for KOVAR, with the descriptions from `metrics.md`.
4. **Insurance & Resources** — Bill Lupinacci, Abbate Agency,
   703-624-9687, bill.lupinacci@kofc.org, plus Catholic resource links.

**Content gap:** the Grand Knight's message body lives in a WordPress page
at `/gk-message/` and is **not** in the repo export. It must be extracted
verbatim from the live homepage. Do not paraphrase it — it is a named
person's signed message.

## Assets

- 33 theme images → `apps/web/public/images/`, preserving their subdirectory
  grouping (`resources/`, `foster-children-support/`).
- KofC brand assets → `apps/web/public/images/brand/`. **PNG only.** The
  `.eps` files are print formats and must not enter a web bundle.
- All images render through `next/image` with explicit dimensions.
- Images referenced from MDX use the `img` mapping in `mdx-components.tsx`
  so no page hand-rolls an `<img>`.

## Footer

`site-footer.tsx` takes the council's real details: Grand Knight Steve
Shields, kofc15256@googlegroups.com, the insurance agent's contact block,
and the social links. The GeneratePress attribution is dropped — it does not
apply to this stack.

## Testing

- **Build-time.** Every MDX page must compile. `pnpm run typecheck` and
  `pnpm run lint` stay at zero errors and zero warnings.
- **Link integrity.** A unit test walks the navigation config and asserts
  every `path` corresponds to a real route file, so a renamed page cannot
  silently 404. This is the one test genuinely worth writing here; prose
  pages do not need unit tests.
- **Playwright.** One spec that visits every public route and asserts a
  heading renders. Cheap, and it fails loudly if the MDX pipeline breaks.
- **Manual.** Compare against the live site side by side, and exercise the
  mobile navigation, including nested items.

## Risks

- **MDX build integration is the one piece that can fail wholesale.** If
  `createMDX` and `pageExtensions` are not configured correctly, `.mdx`
  routes 404 silently rather than erroring. Stand up one page end to end and
  confirm it renders before porting the other nineteen.
- **The content is prose about real people and real services.** Names, email
  addresses, phone numbers and meeting times must be carried over exactly.
  An HTML-entity artefact (`&#8217;`, `&#8212;`) left in the output is a
  visible defect.
- The existing marketing components are template scaffolding; expect to
  rewrite rather than extend `site-footer.tsx` and `site-navigation.tsx`.

## Out of scope, restated

No database changes. No new migrations. No authentication changes. Nothing
under `apps/web/app/home/**` is touched except by linking to it.
