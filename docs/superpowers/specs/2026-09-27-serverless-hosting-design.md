# Serverless Hosting — Design

**Date:** 2026-09-27
**Status:** Draft for review

## Goal

Host the council website without a backend that runs around the clock. The
public site is served as static files from Cloudflare; the member portal runs
only when someone uses it; the database stays on Supabase. Visitors see one
domain, `kofc-15256.org`, which replaces the WordPress site that serves it
today.

## Context

The app is a single Next.js 16.3 app (`apps/web`) holding both the public site
(`app/(marketing)`, ~20 MDX pages) and the member portal (`app/home`,
`app/auth`, webhooks, roster import). It depends on Supabase for auth, Postgres,
RLS, RBAC and pgcrypto-encrypted PII (see the RBAC and roster import specs).
Replacing Supabase was considered and rejected: it would mean rewriting every
feature built so far.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Public site | Static export on Cloudflare Workers static assets | No server at all for the pages most visitors see. The marketing layout is already request-independent. |
| Portal host | Cloud Run, min instances 0 | Runs the unmodified Next.js server (`next start`), scales to zero, request-based billing. |
| Portal on Cloudflare via OpenNext | Rejected | The spike (Appendix A) found OpenNext cannot bundle `proxy.ts` under this pnpm monorepo. |
| Domain layout | One origin; a router Worker sends portal paths to Cloud Run | Keeps existing URLs and the relative dues link working, and one cookie origin keeps the signed-in header working on public pages. |
| Database and auth | Supabase, unchanged | Upgrade from Free to Pro (~$25/month) before cutover. Free pauses after 7 idle days. |
| Deploys | GitHub Actions on push to `main`, production only | No preview environments. |
| Migrations | The Supabase GitHub integration applies them on merge to `main` | Already configured. CI never runs `supabase db push`. |

## Architecture

```
kofc-15256.org  (Cloudflare zone)
│
├─ Workers static assets ─ apps/site/out
│      matching file → served directly; the Worker does not run
│
└─ no file matched → router Worker (apps/router)
        ├─ portal prefix → fetch Cloud Run "portal" (+ X-Origin-Auth)
        └─ anything else → static 404 page
                                  │
                   Cloud Run "portal" (apps/portal, us-east4)
                                  │
                   Supabase Pro (us-east-1)
```

Portal prefixes: `/home`, `/auth`, `/update-password`, `/api`, `/version`,
`/portal-assets`. They are defined once, in `packages/brand`'s
`paths.config`, and imported by both the router Worker and the portal's
`proxy.ts`.

Cold starts: the first portal request after an idle period waits a few seconds
while Cloud Run starts a container. Public pages are never affected. Stripe and
Square retry webhooks, so a cold start loses nothing.

## Units

### `apps/site` (new) — static export

- `next.config`: `output: 'export'`, MDX enabled, `images.unoptimized: true`.
- Moves in from `apps/web`: `app/(marketing)/**`, `mdx-components.tsx`,
  `app/robots.ts`, `app/sitemap.xml/`, `config/site-navigation.config.ts` and
  its two tests, `lib/page-metadata.ts`, `public/images/*`.
- Has its own root `layout.tsx` and a static `not-found.tsx`.
- Also exports `please-wait.html` and the portal-link pre-warm script (see
  [Cold-start experience](#cold-start-experience)).
- Keeps the header's signed-in dropdown, which reads the session in the browser
  (`useUser`). It needs only the public Supabase URL and anon key at build time.
- Must not import `@kit/supabase/server`, `server-only`, or anything server-side.
  The static export build enforces this, and an oxlint `no-restricted-imports`
  rule catches it earlier.

### `apps/portal` (today's `apps/web`, renamed)

- Keeps: `app/home/**`, `app/auth/**`, `app/update-password/`,
  `app/api/webhooks/{stripe,square}`, `app/version/`, `proxy.ts`,
  `instrumentation.ts`, `lib/server/`, `lib/database.types.ts`, `supabase/`,
  `components/auth-provider.tsx`, `components/personal-account-dropdown-container.tsx`.
- `next.config`: MDX removed; `output: 'standalone'`;
  `assetPrefix: '/portal-assets'`, so its chunks never collide with the site's
  `/_next/static`.
- `proxy.ts` gains the origin lock (below). Its matcher widens to include
  `/api/*`.
- `/version` reads `GIT_HASH`, set at deploy.

### `packages/brand` (new)

Holds what both apps render, so neither app imports from the other:
`app-logo.tsx`, `lib/fonts.ts`, `lib/root-metdata.ts`, `styles/*.css`,
`components/root-providers.tsx`, `components/skeletons/`,
`config/app.config.ts`, `config/paths.config.ts` (including the portal
prefixes) and `config/feature-flags.config.ts`. Translation messages stay in
`@kit/i18n`.

### `apps/router` (new) — Cloudflare Worker

- `wrangler.jsonc`: assets bound to `../site/out`,
  `not_found_handling: "404-page"`, the custom domain `kofc-15256.org`, and the
  secrets `PORTAL_ORIGIN` and `ORIGIN_AUTH`.
- A path with a portal prefix is proxied to `PORTAL_ORIGIN`:
  - The method, headers and body are streamed through unchanged, which keeps
    webhook signatures valid.
  - `redirect: 'manual'`, so the portal's redirects reach the browser as they
    are.
  - It adds `X-Forwarded-Host`, `X-Forwarded-Proto` and
    `X-Origin-Auth: <ORIGIN_AUTH>`.
  - For `/portal-assets/*` it strips the prefix before proxying: the browser
    requests `/portal-assets/_next/static/…` because of `assetPrefix`, but the
    Next server serves those files at `/_next/static/…`. A router test covers
    this.
- Any other path returns the site's 404 page and never wakes Cloud Run.
- Portal page navigations can get the cold-start page described in
  [Cold-start experience](#cold-start-experience).
- The optional `SIMULATE_COLD_START_MS` variable delays every proxied response.
  It is set only in local development, so the cold-start page can be tested.

### Origin lock

Cloud Run's `*.run.app` URL is public. `proxy.ts` returns 404 to any request
whose `X-Origin-Auth` does not match the secret, so the portal can only be
reached through Cloudflare. This was chosen over Cloud Run IAM with signed ID
tokens, which would mean minting Google tokens inside the Worker. The lock only
controls origin access; user auth still goes through Supabase.

### Cloud Run service `portal`

| Setting | Value |
| --- | --- |
| Region | `us-east4` (N. Virginia, next to Supabase `us-east-1`) |
| Min / max instances | 0 / 3 |
| CPU / memory | 1 vCPU / 1 GiB (ExcelJS parses rosters in memory) |
| Billing | Request-based (CPU allocated only during requests) |
| Request timeout | 300 s |
| Image | Multi-stage Docker, `node:24-slim`, Next `standalone`, built from `turbo prune portal` |
| Secrets | Secret Manager, injected as env vars: Supabase service-role key, Stripe keys, Square keys, `ORIGIN_AUTH` |

Expected cost at council traffic: $0 for Cloud Run and Workers, which stay
within their free tiers (static hits do not count as Worker requests). The total
is about $25/month, for Supabase Pro.

## Cold-start experience

While the portal container starts (a few seconds after an idle period), no
portal code runs. A Suspense boundary inside the portal cannot cover that gap,
so the experience comes from Cloudflare, in two layers.

**1. Pre-warming from the public site.** A small client script in `apps/site`
sends `fetch('/version', { method: 'HEAD' })` the first time any portal link is
hovered, focused or touched, at most once per page view. The container starts
during the moment before the click lands, so most visitors never see a cold
start.

**2. The "Please wait..." page from the router.**
- It applies only to portal page navigations: `GET` requests whose `Accept`
  header includes `text/html`.
- The router races the proxied fetch against a 1.5-second timer.
  - **The portal responds first:** its response is returned as normal.
  - **The timer wins:** the router returns `please-wait.html` from the site
    export, with status 503, `Retry-After: 2` and `Cache-Control: no-store`.
- The page:
  - Shows the brand header, a spinner and the text "Please wait...".
  - Keeps the requested URL, so nothing about the destination changes.
  - Polls `/version` every second and calls `location.reload()` once it returns
    200.
  - After 30 seconds it shows a "Try again" button instead of polling forever.
- The original fetch is not cancelled. It continues under `ctx.waitUntil` and
  finishes warming the container.

**Excluded from the "Please wait..." page, so these simply wait:**
- `/auth/callback` and `/auth/confirm`. They carry one-time codes, and the
  abandoned first request could use the code up, so the reload would then fail.
- Non-`GET` requests: server actions, form posts and webhooks.
- Asset requests (`/portal-assets/*`).

Once the container is up, portal pages keep their own `loading.tsx` Suspense
boundaries for slow data.

## Local development

Two modes:

- **`pnpm dev`** is unchanged day-to-day development: `next dev` for
  `apps/site` and `apps/portal` with hot reload. The local site runs on port
  3000 and the portal on port 3001. The site's links to portal paths go to
  `NEXT_PUBLIC_PORTAL_URL`, which is unset in production (same origin).
- **`pnpm stack:up` / `pnpm stack:down`** run the production-like stack with
  Docker Compose (`compose.yaml` at the repo root):
  - `portal` is built from the **same Dockerfile** as Cloud Run, so what is
    tested is what ships.
  - `router` runs `wrangler dev` in a Node container, serving the built
    `apps/site/out` and the router Worker at `http://localhost:3000`.
  - It uses local values for `ORIGIN_AUTH` and `PORTAL_ORIGIN`
    (`http://portal:3000`).

**Supabase stays on the CLI-managed stack** (`pnpm supabase:web:start`, which is
itself Docker). Compose services reach it through
`host.docker.internal:54321`, and the portal container's env points there.
Rebuilding Supabase's dozen services in Compose would duplicate what the CLI
already maintains.

`SIMULATE_COLD_START_MS=5000 pnpm stack:up` exercises the "Please wait..." page
locally.

## CI/CD

A new workflow, `.github/workflows/deploy.yml`, runs on push to `main` after the
existing typecheck and lint jobs pass:

1. **site:** `pnpm --filter site build` produces `apps/site/out`.
2. **portal:** build the image, push it to Artifact Registry (`us-east4`), then
   run `gcloud run deploy portal --image …@sha256:… --set-env-vars GIT_HASH=…`.
3. **router:** runs after 1 and 2 succeed. `wrangler deploy` publishes the site
   files and the Worker together.

Credentials:
- **Google Cloud:** Workload Identity Federation, trusting only this repo's
  `main` branch. No service-account key is stored in GitHub.
- **Cloudflare:** a scoped API token (Workers edit) stored as a GitHub secret.
- **Runtime secrets** live in Secret Manager and as Worker secrets; CI never
  handles their values.

**Migrations.** The Supabase GitHub integration applies migrations on merge to
`main`, in parallel with this workflow. Nothing orders the two, so **every
migration must be backward-compatible**: add first, remove in a later deploy.
The running portal must work against both the old and the new schema.

**Rollback:**
- Portal:
  `gcloud run services update-traffic portal --to-revisions=<previous>=100`.
- Site and router: `wrangler rollback`.
- Migrations are not rolled back automatically. Write a forward fix.

## Cutover

Prerequisites:

1. Upgrade the Google Cloud account from the free trial to a paid billing
   account. When the trial ends, resources shut down unless the account has been
   upgraded. Cloud Run's free tier still applies.
2. Upgrade Supabase from Free to Pro.
3. The `kofc-15256.org` zone is already on Cloudflare; no DNS move is needed.

Steps:

1. Split and rename (`apps/web` → `apps/portal` + `apps/site`). **In the same
   merge,** change the Supabase GitHub integration's working directory from
   `apps/web` to `apps/portal`, or new migrations stop being applied. Then
   confirm the next migration was applied.
2. Deploy to the `*.workers.dev` URL. Add both that URL and
   `https://kofc-15256.org` to Supabase auth redirect URLs. Run the smoke test.
3. Register webhook endpoints at
   `https://kofc-15256.org/api/webhooks/{stripe,square}`.
4. Attach the custom domain to the router Worker. WordPress stops receiving
   traffic.
5. Keep WordPress running, but unrouted, for two weeks as a fallback.

## Testing

- **Unit tests** move with their code, unchanged.
- **Split guard:** CI builds `apps/site` with `output: 'export'`, and the oxlint
  rule rejects server-only imports.
- **Router Worker** (Vitest, `@cloudflare/vitest-pool-workers`):
  - portal prefixes are proxied with the method, body and headers intact
  - `X-Origin-Auth` and `X-Forwarded-*` are added
  - misses outside the portal prefixes return the 404 page without calling the
    origin
  - redirects are passed through, not followed
  - `/portal-assets/…` is proxied with the prefix stripped
  - an HTML `GET` slower than 1.5 s gets the "Please wait..." page (503,
    `no-store`) and the origin fetch continues under `waitUntil`
  - `/auth/callback`, `/auth/confirm`, non-`GET` requests and assets never get
    the "Please wait..." page
- **Please-wait page** (Vitest, jsdom):
  - it reloads once `/version` returns 200
  - it shows "Try again" after 30 s
- **Pre-warm script:** fires once per page view, only for portal links.
- **Origin lock:** `proxy.ts` returns 404 for a missing or wrong
  `X-Origin-Auth`, including on `/api/webhooks/*`, and passes the correct value.
- **End-to-end:** the Playwright suites in `apps/e2e` run against
  `pnpm stack:up` (the Compose stack), so requests take the same path as in
  production. One e2e test runs with `SIMULATE_COLD_START_MS` and checks that
  the "Please wait..." page appears, then gives way to the portal page.
- **Post-deploy smoke test:**
  - a public page loads
  - `/version` returns the deployed commit
  - sign-in completes a round trip
  - a Stripe test webhook returns 2xx

## Risks

| Risk | Mitigation |
| --- | --- |
| Migrations and the portal deploy race | Backward-compatible migration rule |
| The rename breaks the Supabase integration's working directory without warning | Cutover step 1 changes it in the same merge and verifies the next migration |
| Cold start on the first portal request after idle | Accepted. Raise min instances to 1 (~$10–15/month) if members notice |
| `ORIGIN_AUTH` leaks | Rotate it in both the Worker secret and Secret Manager |
| Supabase Free pauses before launch | Pro upgrade is a cutover prerequisite |
| The GCP trial expires and shuts down the portal | Billing upgrade is a cutover prerequisite |

## Template and configuration leftovers

Removed or rewritten as part of the split, since the rename touches them anyway:

- `README.md`: replace MakerKit's Vercel, Cloudflare and Railway deploy
  sections with this project's deploy, local stack and rollback instructions.
- `app/version/route.ts`: drop `CF_PAGES_COMMIT_SHA` and
  `VERCEL_GIT_COMMIT_SHA`; read only `GIT_HASH`.
- `.run/*.run.xml` (tracked IDE run configs): repoint them from `apps/web` to
  `apps/site` and `apps/portal`, and add "Local stack (Docker)".
- `.idea/awsToolkit.xml`: stop tracking it. It is personal IDE state for an AWS
  toolkit this project does not use.

The Supabase `project_id` (`next-supabase-saas-kit-turbo-lite`) stays as it is.
Renaming it would orphan the current local database volume.

## Out of scope

WordPress hosting shutdown, transactional email and SMTP, and preview
environments.

## Appendix A — OpenNext spike (2026-09-27)

Before choosing Cloud Run, a throwaway spike tested running the whole app on
Workers with `@opennextjs/cloudflare` 1.20.6 (Next 16.3.0, Linux container):

| Check | Result |
| --- | --- |
| Next.js production build (Turbopack, `cacheComponents`, MDX, page data) | Passes |
| OpenNext server bundle | Passes after adding `@opentelemetry/api` as a dependency |
| OpenNext middleware (`proxy.ts`) bundle | Fails. Next's tracing copies only the CommonJS build of `@opentelemetry/api`, but its `package.json` points esbuild at the ESM build, which is never copied. `outputFileTracingIncludes` does not apply to the middleware trace, and the hoisted-linker workarounds did not take effect under pnpm 11. |

The passing Next.js build also shows the portal builds as a standard Node server
on Linux, which is what Cloud Run runs.
