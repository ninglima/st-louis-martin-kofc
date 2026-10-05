# Serverless Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single Next.js app into a static public site served by a Cloudflare Worker and a scale-to-zero member portal on Cloud Run, behind one origin, with a cold-start "Please wait..." page, a local Docker stack, and a CI/CD deploy.

**Architecture:** `apps/web` is renamed `apps/portal`. Its public routes move to a new static-export app, `apps/site`. Code both apps render moves to a new package, `@kit/brand`. A new Worker, `apps/router`, serves the site files and proxies a fixed list of portal path prefixes to Cloud Run. It adds a shared-secret header that the portal's `proxy.ts` checks, and rewrites redirects so they never expose the Cloud Run host. Supabase is unchanged.

**Tech Stack:** Next.js 16.3 (Turbopack, `output: 'export'` / `output: 'standalone'`), pnpm 11 workspaces, Turborepo, Cloudflare Workers with static assets (wrangler 4), `@cloudflare/vitest-pool-workers`, Vitest 4, Playwright, Docker Compose, Google Cloud Run, Artifact Registry, Secret Manager, Workload Identity Federation, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-serverless-hosting-design.md`

## Global Constraints

- One origin: `kofc-15256.org`. Portal prefixes, exactly: `/home`, `/auth`, `/update-password`, `/api`, `/version`, `/portal-assets`.
- Portal prefixes are defined once, in `@kit/brand`'s paths config, and imported by the router and the portal.
- The portal sets `assetPrefix: '/portal-assets'`. The router strips that prefix before proxying.
- Origin lock header: `X-Origin-Auth`. Secret env var name: `ORIGIN_AUTH`, in both the Worker and the portal.
- Router env: `PORTAL_ORIGIN` (the Cloud Run URL), `ORIGIN_AUTH` (secret), optional `SIMULATE_COLD_START_MS` (local only).
- Cold-start copy is exactly `Please wait...`. The waiting page is served with status 503, `Retry-After: 2` and `Cache-Control: no-store`, after a 1.5 s race. It polls every 1 s and shows "Try again" after 30 s.
- The "Please wait..." page is never shown for `/auth/callback`, `/auth/confirm`, non-`GET` requests, or `/portal-assets/*`.
- Cloud Run: region `us-east4`; min / max instances 0 / 3; 1 vCPU / 1 GiB; request-based billing; 300 s timeout; image `node:24-slim`.
- Deploys: GitHub Actions on push to `main`, production only. GCP auth is Workload Identity Federation, trusting only this repo's `main`. Cloudflare uses a scoped API token.
- Migrations: CI never runs `supabase db push`; the Supabase GitHub integration applies them. Every migration must be backward-compatible.
- The Supabase `project_id` stays `next-supabase-saas-kit-turbo-lite`.
- pnpm 11 reads settings from `pnpm-workspace.yaml`, not `.npmrc`.
- `apps/site` must not import `@kit/supabase/server`, `server-only`, or `next/headers`.
- **Never run anything that changes shared cloud state** (`gcloud` create or deploy, `wrangler deploy`, `wrangler secret put`, GitHub settings, DNS) without the user's explicit go-ahead in that session. Tasks 12 and 13 write scripts and docs; the user runs them.

## Review Focus

1. **Prefix look-alikes.** `/homework`, `/authors`, `/api-docs` and `/versions` must be served as static pages (or the 404 page), never proxied. `/home` and `/home/` must be proxied. This is tested in Task 2 (`isPortalPath`) and Task 7 (router).
2. **Redirects that leak the Cloud Run host.** The portal builds redirect URLs from the request `Host`, which behind the router is `*.run.app`. The router must rewrite a `Location` on the portal origin to the public origin, keeping the path and query. Tested in Task 7.
3. **Several `Set-Cookie` headers in one response.** A Supabase sign-in sets several cookies, and the router must pass every one to the browser. Tested in Task 7.
4. **Query strings survive the hop.** `/auth/sign-in?next=/home/checkout` must reach the portal with its query, and the "Please wait..." page must reload the exact URL, query included. Tested in Tasks 7 and 8.
5. **Request bodies are forwarded byte-for-byte.** Stripe and Square signatures and the ~6 MB roster upload break if the body is re-encoded or truncated. Tested in Task 7 with a binary body.
6. **Portal links on the static site do a full page load.** A client-side `next/link` transition to `/home` would request a site RSC payload that doesn't exist. Tested in Task 4.

---

## File Structure

```
apps/
  portal/                     (renamed from apps/web; marketing removed)
    Dockerfile                NEW  production image, built from repo root
    lib/origin-lock.ts        NEW  pure X-Origin-Auth check
    lib/origin-lock.test.ts   NEW
    components/portal-header.tsx  NEW  minimal header for error/404 pages
    app/page.tsx              NEW  redirects "/" to the site (reached only in `pnpm dev`)
  site/                       NEW  static export (output: 'export')
    app/(marketing)/**        MOVED from apps/web
    app/please-wait/page.tsx  NEW  cold-start page
    app/sitemap.ts            NEW  replaces app/sitemap.xml/route.ts
    components/site-link.tsx  NEW  <a> for portal paths, next/link otherwise
    components/portal-prewarm.tsx NEW
    lib/portal-href.ts(+test) NEW
    lib/wait-for-portal.ts(+test) NEW
    lib/prewarm.ts(+test)     NEW
  router/                     NEW  Cloudflare Worker
    src/index.ts              fetch handler: race, please-wait, 404
    src/routing.ts(+test)     request classification
    src/forward.ts(+test)     origin request and Location rewrite
    src/cold-start.ts(+test)  local cold-start simulation
    wrangler.jsonc, vitest.config.ts, Dockerfile.dev
packages/
  brand/                      NEW  @kit/brand: logo, fonts, metadata, configs, providers, i18n messages, styles
compose.yaml                  NEW  local production-like stack
infra/gcp/setup.sh            NEW  one-time GCP setup (the user runs it)
.github/workflows/deploy.yml  NEW
docs/runbook/hosting.md       NEW  deploy, rollback, cutover checklist
```

---

### Task 1: Rename `apps/web` to `apps/portal`

A pure rename, with no behaviour change, so every later diff reads as a real change.

**Files:**
- Move: `apps/web/**` → `apps/portal/**`
- Modify: `apps/portal/package.json` (`"name": "web"` → `"portal"`), root `package.json` scripts, `apps/e2e/tests/public-site/public-site.spec.ts` import path, `.github/workflows/workflow.yml`, `.run/*.run.xml`, `apps/portal/app/home/settings/payments/page.tsx` (unchanged logic; confirm no path literal), `turbo.json` (none expected)

**Interfaces:**
- Produces: the workspace package `portal` at `apps/portal`. Later tasks use `pnpm --filter portal`.

- [ ] **Step 1: Branch and move**

```bash
git checkout -b feat/serverless-hosting main
git mv apps/web apps/portal
```

- [ ] **Step 2: Rename the package and update references**

In `apps/portal/package.json`, set `"name": "portal"`.

Then find every remaining reference:

```bash
grep -rn --exclude-dir=node_modules --exclude-dir=.next -e "apps/web" -e "--filter web" -e "filter=web" -e "'web'" -e '"web"' \
  package.json turbo.json .github .run apps packages tooling docs/runbook 2>/dev/null
```

Update each hit:
- Root `package.json`: every `pnpm --filter web …` → `pnpm --filter portal …`. Keep the script names (`supabase:web:start` etc.) so muscle memory and CI keep working.
- `.github/workflows/workflow.yml`: `--filter web` → `--filter portal`.
- `.run/*.run.xml`: `apps/web` → `apps/portal`.
- `apps/e2e/tests/public-site/public-site.spec.ts`: `'../../../web/config/site-navigation.config'` → `'../../../portal/config/site-navigation.config'`. Task 3 moves it again.
- `apps/portal/.env`: `NEXT_PUBLIC_LOCALES_PATH=apps/web/i18n/messages` → `apps/portal/i18n/messages`. Task 2 moves it again.

- [ ] **Step 3: Reinstall and verify nothing broke**

```bash
CI=true pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter portal test:unit
pnpm lint && pnpm format
```

Expected: all pass. Portal unit tests: 57 passed.

- [ ] **Step 4: Commit**

```bash
git add -A apps/portal apps/web package.json .github .run apps/e2e pnpm-lock.yaml
git commit -m "refactor: rename apps/web to apps/portal"
```

**Manual (user, at merge time, from the spec's Cutover step 1):** in the Supabase dashboard, change the GitHub integration's working directory from `apps/web` to `apps/portal`. The runbook in Task 13 records this.

---

### Task 2: Create `@kit/brand` with the code both apps render

**Files:**
- Create: `packages/brand/package.json`, `packages/brand/tsconfig.json`, `packages/brand/src/config/paths.config.ts`, `packages/brand/src/config/paths.config.test.ts`, `packages/brand/src/base-providers.tsx`, `packages/brand/src/i18n/load-messages.ts`
- Move (with `git mv`) into `packages/brand/src/`:
  - `apps/portal/components/app-logo.tsx` → `app-logo.tsx`
  - `apps/portal/lib/fonts.ts` → `fonts.ts`
  - `apps/portal/lib/root-metdata.ts` → `root-metadata.ts` (fixes the typo)
  - `apps/portal/components/react-query-provider.tsx` → `react-query-provider.tsx`
  - `apps/portal/components/skeletons/` → `skeletons/`
  - `apps/portal/config/app.config.ts` → `config/app.config.ts`
  - `apps/portal/config/feature-flags.config.ts` → `config/feature-flags.config.ts`
  - `apps/portal/config/paths.config.ts` → `config/paths.config.ts`
- Move: `apps/portal/styles/{theme,theme.utilities,shadcn-ui,markdoc,makerkit}.css` → `packages/brand/styles/`
- Move: `apps/portal/i18n/messages/` → `packages/brand/i18n/messages/`
- Modify: `apps/portal/styles/globals.css`, `apps/portal/i18n/request.ts`, `apps/portal/components/root-providers.tsx`, every portal import of the moved modules, `apps/portal/package.json` (add `"@kit/brand": "workspace:*"`), `apps/portal/next.config.mjs` (`INTERNAL_PACKAGES` gains `'@kit/brand'`), `apps/portal/.env` (`NEXT_PUBLIC_LOCALES_PATH=packages/brand/i18n/messages`)

Deviation from the spec: the spec said translation messages "stay in `@kit/i18n`", but they actually live in the app (`apps/web/i18n/messages`). Both apps need them, so they move to `@kit/brand`.

**Interfaces:**
- Produces (import specifiers):
  - `@kit/brand/app-logo` → `AppLogo`, `AppEmblem`
  - `@kit/brand/fonts` → `sans`, `heading`
  - `@kit/brand/root-metadata` → `generateRootMetadata(): Metadata`
  - `@kit/brand/config/app` → default `appConfig`
  - `@kit/brand/config/feature-flags` → default `featuresFlagConfig`
  - `@kit/brand/config/paths` → default `pathsConfig`, plus `PORTAL_PREFIXES: readonly ['/home','/auth','/update-password','/api','/version','/portal-assets']` and `isPortalPath(pathname: string): boolean`
  - `@kit/brand/providers` → `BaseProviders({ locale, messages, theme?, children })`
  - `@kit/brand/i18n` → `loadMessages(locale: string): Promise<Record<string, unknown>>`, `MESSAGE_NAMESPACES`
  - `@kit/brand/skeletons/*` → the existing skeleton components, unchanged

- [ ] **Step 1: Write the failing test for the portal prefixes**

`packages/brand/src/config/paths.config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PORTAL_PREFIXES, isPortalPath } from './paths.config';

describe('isPortalPath', () => {
  it.each([
    '/home',
    '/home/',
    '/home/members',
    '/auth/sign-in',
    '/auth/callback',
    '/update-password',
    '/api/webhooks/stripe',
    '/version',
    '/portal-assets/_next/static/chunks/app.js',
  ])('treats %s as a portal path', (path) => {
    expect(isPortalPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/homework',
    '/authors',
    '/api-docs',
    '/versions',
    '/who-we-are',
    '/get-involved/pay-dues',
    '/please-wait',
    '/_next/static/chunks/app.js',
  ])('treats %s as a site path', (path) => {
    expect(isPortalPath(path)).toBe(false);
  });

  it('pins the exact prefix list the router and portal share', () => {
    expect(PORTAL_PREFIXES).toEqual([
      '/home',
      '/auth',
      '/update-password',
      '/api',
      '/version',
      '/portal-assets',
    ]);
  });
});
```

- [ ] **Step 2: Create the package skeleton and move the files**

`packages/brand/package.json`:

```json
{
  "name": "@kit/brand",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./app-logo": "./src/app-logo.tsx",
    "./fonts": "./src/fonts.ts",
    "./root-metadata": "./src/root-metadata.ts",
    "./providers": "./src/base-providers.tsx",
    "./i18n": "./src/i18n/load-messages.ts",
    "./config/app": "./src/config/app.config.ts",
    "./config/feature-flags": "./src/config/feature-flags.config.ts",
    "./config/paths": "./src/config/paths.config.ts",
    "./skeletons/*": "./src/skeletons/*.tsx",
    "./styles/*": "./styles/*"
  },
  "scripts": {
    "clean": "git clean -xdf .turbo node_modules",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@kit/i18n": "workspace:*",
    "@kit/ui": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "next": "catalog:",
    "next-intl": "catalog:",
    "next-themes": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@kit/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/brand/tsconfig.json`:

```json
{
  "extends": "@kit/tsconfig/base.json",
  "compilerOptions": {
    "resolveJsonModule": true,
    "tsBuildInfoFile": "node_modules/.cache/tsbuildinfo.json"
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

Move the files listed above with `git mv`. Inside the moved files, replace `~/…` imports with relative ones. For example, `root-metadata.ts` imports `appConfig from './config/app.config'`.

- [ ] **Step 3: Add the prefixes to `paths.config.ts`**

Append to `packages/brand/src/config/paths.config.ts`:

```ts
/**
 * Every path the member portal serves. The router proxies exactly these to
 * Cloud Run and serves everything else from the static site, and the portal's
 * `proxy.ts` reads the same list, so the two cannot drift apart. Matching is
 * per path segment: `/home` and `/home/x` are portal paths, `/homework` is not.
 */
export const PORTAL_PREFIXES = [
  '/home',
  '/auth',
  '/update-password',
  '/api',
  '/version',
  '/portal-assets',
] as const;

export function isPortalPath(pathname: string): boolean {
  return PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm install && pnpm --filter @kit/brand test:unit
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Split the providers**

`packages/brand/src/base-providers.tsx`:

```tsx
'use client';

import type { AbstractIntlMessages } from 'next-intl';
import { ThemeProvider } from 'next-themes';

import { I18nClientProvider } from '@kit/i18n/provider';

import appConfig from './config/app.config';
import { ReactQueryProvider } from './react-query-provider';

/**
 * The providers both apps need: data fetching (the header's `useUser` reads
 * the session through React Query), translations and the theme. The portal
 * wraps these with its captcha, auth listener and version updater; the static
 * site uses them as they are.
 */
export function BaseProviders({
  locale,
  messages,
  theme = appConfig.theme,
  children,
}: React.PropsWithChildren<{
  locale: string;
  messages: AbstractIntlMessages;
  theme?: string;
}>) {
  return (
    <ReactQueryProvider>
      <I18nClientProvider locale={locale} messages={messages}>
        <ThemeProvider
          attribute="class"
          enableSystem
          disableTransitionOnChange
          defaultTheme={theme}
          enableColorScheme={false}
        >
          {children}
        </ThemeProvider>
      </I18nClientProvider>
    </ReactQueryProvider>
  );
}
```

Rewrite `apps/portal/components/root-providers.tsx` so it composes `BaseProviders`. Keep its public props (`locale`, `messages`, `theme`, `children`) and its behaviour:

```tsx
'use client';

import dynamic from 'next/dynamic';

import type { AbstractIntlMessages } from 'next-intl';

import { CaptchaProvider } from '@kit/auth/captcha/client';
import appConfig from '@kit/brand/config/app';
import featuresFlagConfig from '@kit/brand/config/feature-flags';
import { BaseProviders } from '@kit/brand/providers';
import { If } from '@kit/ui/if';
import { VersionUpdater } from '@kit/ui/version-updater';

import { AuthProvider } from '~/components/auth-provider';
import authConfig from '~/config/auth.config';

const captchaSiteKey = authConfig.captchaTokenSiteKey;

const CaptchaTokenSetter = dynamic(async () => {
  if (!captchaSiteKey) {
    return Promise.resolve(() => null);
  }

  const { CaptchaTokenSetter } = await import('@kit/auth/captcha/client');

  return {
    default: CaptchaTokenSetter,
  };
});

export function RootProviders({
  locale,
  messages,
  theme = appConfig.theme,
  children,
}: React.PropsWithChildren<{
  locale: string;
  messages: AbstractIntlMessages;
  theme?: string;
}>) {
  return (
    <BaseProviders locale={locale} messages={messages} theme={theme}>
      <CaptchaProvider>
        <CaptchaTokenSetter siteKey={captchaSiteKey} />

        <AuthProvider>{children}</AuthProvider>
      </CaptchaProvider>

      <If condition={featuresFlagConfig.enableVersionUpdater}>
        <VersionUpdater />
      </If>
    </BaseProviders>
  );
}
```

Note: the theme provider now wraps the auth and captcha providers instead of sitting inside them. Neither reads the theme, so the order doesn't matter.

- [ ] **Step 6: Share the message loader**

`packages/brand/src/i18n/load-messages.ts`:

```ts
/**
 * Translation namespaces shared by the site and the portal. Each lives in
 * `packages/brand/i18n/messages/<locale>/<namespace>.json`.
 */
export const MESSAGE_NAMESPACES = [
  'common',
  'auth',
  'account',
  'teams',
  'billing',
  'marketing',
  'payments',
  'rbac',
] as const;

export async function loadMessages(
  locale: string,
): Promise<Record<string, unknown>> {
  const loaded: Record<string, unknown> = {};

  await Promise.all(
    MESSAGE_NAMESPACES.map(async (namespace) => {
      try {
        const messages = await import(
          `../../i18n/messages/${locale}/${namespace}.json`
        );
        loaded[namespace] = messages.default;
      } catch (error) {
        console.warn(
          `Failed to load namespace "${namespace}" for locale "${locale}":`,
          error,
        );
        loaded[namespace] = {};
      }
    }),
  );

  return loaded;
}
```

In `apps/portal/i18n/request.ts`, delete the local `namespaces` array and `loadMessages` function. Import `loadMessages` from `@kit/brand/i18n` instead, and keep the long comment and the `getRequestConfig` body.

- [ ] **Step 7: Point the portal at the moved CSS and modules**

`apps/portal/styles/globals.css`: replace the five local `@import './….css'` lines with:

```css
@import '../../../packages/brand/styles/theme.css';
@import '../../../packages/brand/styles/theme.utilities.css';
@import '../../../packages/brand/styles/shadcn-ui.css';
@import '../../../packages/brand/styles/markdoc.css';
@import '../../../packages/brand/styles/makerkit.css';
```

and add, next to the other `@source` lines:

```css
@source "../../../packages/brand/src/**/*.{ts,tsx}";
```

Rewrite the portal's imports:

```bash
cd apps/portal
grep -rl --include=*.ts --include=*.tsx -e "~/config/app.config'" -e "~/config/paths.config'" -e "~/config/feature-flags.config'" -e "~/components/app-logo'" -e "~/lib/fonts'" -e "~/lib/root-metdata'" -e "~/components/skeletons/" . | grep -v node_modules | xargs sed -i '' \
  -e "s#'~/config/app.config'#'@kit/brand/config/app'#" \
  -e "s#'~/config/paths.config'#'@kit/brand/config/paths'#" \
  -e "s#'~/config/feature-flags.config'#'@kit/brand/config/feature-flags'#" \
  -e "s#'~/components/app-logo'#'@kit/brand/app-logo'#" \
  -e "s#'~/lib/fonts'#'@kit/brand/fonts'#" \
  -e "s#'~/lib/root-metdata'#'@kit/brand/root-metadata'#" \
  -e "s#'~/components/skeletons/#'@kit/brand/skeletons/#"
cd ../..
```

(`sed -i ''` is BSD/macOS syntax. On Linux use `sed -i`.)

- [ ] **Step 8: Verify**

```bash
pnpm install
pnpm typecheck && pnpm --filter portal test:unit && pnpm --filter @kit/brand test:unit
pnpm lint && pnpm format
pnpm --filter portal build
```

Expected: all pass, and the build succeeds. The build still includes the marketing pages at this point.

- [ ] **Step 9: Commit**

```bash
git add -A packages/brand apps/portal pnpm-lock.yaml
git commit -m "refactor: move code both apps render into @kit/brand"
```

---

### Task 3: Create `apps/site` as a static export and move the public site into it

**Files:**
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/next.config.mjs`, `apps/site/postcss.config.mjs` (copy of the portal's), `apps/site/i18n/request.ts`, `apps/site/app/layout.tsx`, `apps/site/app/not-found.tsx`, `apps/site/app/sitemap.ts`, `apps/site/styles/globals.css`, `apps/site/.env` (copy of `apps/portal/.env`), `apps/site/.gitignore` (`out/`)
- Move: `apps/portal/app/(marketing)/` → `apps/site/app/(marketing)/`, `apps/portal/mdx-components.tsx` → `apps/site/`, `apps/portal/app/robots.ts` → `apps/site/app/`, `apps/portal/config/site-navigation.config.ts` and its two tests → `apps/site/config/`, `apps/portal/lib/page-metadata.ts` → `apps/site/lib/`, `apps/portal/public/images/` → `apps/site/public/images/`, but copy `public/images/brand/` and `public/images/favicon/` back into the portal, because the portal renders the logo and favicon too
- Delete: `apps/portal/app/sitemap.xml/`
- Create in the portal: `apps/portal/app/page.tsx`, `apps/portal/components/portal-header.tsx`. Modify `apps/portal/app/{not-found,error,global-error}.tsx` so they use `PortalHeader` instead of the marketing `SiteHeader`.
- Modify: `apps/portal/next.config.mjs` (remove MDX), `apps/portal/package.json` (remove `@next/mdx`, `@mdx-js/*`, `@types/mdx`, `next-sitemap`), `apps/e2e/tests/public-site/public-site.spec.ts` (import from `../../../site/config/site-navigation.config`)

**Interfaces:**
- Consumes: everything `@kit/brand` produces (Task 2).
- Produces: `pnpm --filter site build` writes `apps/site/out/` (one `.html` per route, `404.html`, `sitemap.xml`, `robots.txt`). The workspace package is named `site`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p apps/site/app apps/site/config apps/site/lib apps/site/public
git mv "apps/portal/app/(marketing)" "apps/site/app/(marketing)"
git mv apps/portal/mdx-components.tsx apps/site/mdx-components.tsx
git mv apps/portal/app/robots.ts apps/site/app/robots.ts
git mv apps/portal/config/site-navigation.config.ts apps/site/config/
git mv apps/portal/config/site-navigation.config.test.ts apps/site/config/
git mv apps/portal/config/site-navigation.routes.test.ts apps/site/config/
git mv apps/portal/lib/page-metadata.ts apps/site/lib/page-metadata.ts
git mv apps/portal/public/images apps/site/public/images
mkdir -p apps/portal/public/images
cp -R apps/site/public/images/brand apps/site/public/images/favicon apps/portal/public/images/
git rm -r apps/portal/app/sitemap.xml
```

- [ ] **Step 2: Create the site package**

`apps/site/package.json`:

```json
{
  "name": "site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "clean": "git clean -xdf .next .turbo out node_modules",
    "dev": "next dev --port 3000",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@kit/accounts": "workspace:*",
    "@kit/brand": "workspace:*",
    "@kit/i18n": "workspace:*",
    "@kit/supabase": "workspace:*",
    "@kit/ui": "workspace:*",
    "@mdx-js/loader": "^3.1.1",
    "@mdx-js/react": "^3.1.1",
    "@next/mdx": "^16.3.5",
    "lucide-react": "catalog:",
    "next": "catalog:",
    "next-intl": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@kit/tsconfig": "workspace:*",
    "@tailwindcss/postcss": "catalog:",
    "@types/mdx": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "tailwindcss": "catalog:",
    "tailwindcss-animate": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`apps/site/tsconfig.json`: copy `apps/portal/tsconfig.json` unchanged. The `~/*` aliases keep every moved import in `(marketing)` valid.

`apps/site/next.config.mjs`:

```js
import createMDX from '@next/mdx';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * The public site is plain files. `output: 'export'` makes a server-only
 * import, a request-time API or a route handler without a static result fail
 * the build, which is the guard that keeps this app serverless.
 * `cacheComponents` is deliberately off: there is no request to cache
 * against.
 */
/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  transpilePackages: [
    '@kit/ui',
    '@kit/brand',
    '@kit/i18n',
    '@kit/supabase',
    '@kit/accounts',
  ],
  images: { unoptimized: true },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx'],
  },
  experimental: {
    mdxRs: true,
    useTypeScriptCli: true,
  },
  typescript: { ignoreBuildErrors: true },
};

export default withNextIntl(createMDX()(config));
```

`apps/site/i18n/request.ts`:

```ts
import { getRequestConfig } from 'next-intl/server';

import { loadMessages } from '@kit/brand/i18n';
import { routing } from '@kit/i18n/routing';

/** Static locale, as in the portal: nothing here reads the request. */
export default getRequestConfig(async () => {
  const locale = routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'UTC',
    getMessageFallback(info) {
      return info.key;
    },
  };
});
```

`apps/site/styles/globals.css`: copy `apps/portal/styles/globals.css` (as Task 2 left it). Change the last `@source` line to `@source "../{app,components,config,lib}/**/*.{ts,tsx,mdx}";`.

`apps/site/app/layout.tsx`:

```tsx
import { getMessages } from 'next-intl/server';

import { heading, sans } from '@kit/brand/fonts';
import { BaseProviders } from '@kit/brand/providers';
import { generateRootMetadata } from '@kit/brand/root-metadata';
import { routing } from '@kit/i18n/routing';
import { cn } from '@kit/ui/utils';

import { PortalPrewarm } from '~/components/portal-prewarm';

import '../styles/globals.css';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = routing.defaultLocale;
  const messages = await getMessages({ locale });

  return (
    <html
      lang={locale}
      className={cn(
        'bg-background min-h-screen antialiased',
        sans.variable,
        heading.variable,
      )}
      suppressHydrationWarning
    >
      <body>
        <BaseProviders locale={locale} messages={messages}>
          {children}
        </BaseProviders>
        <PortalPrewarm />
      </body>
    </html>
  );
}

export const generateMetadata = generateRootMetadata;
```

Task 9 creates `PortalPrewarm`. Until then, add a stub at `apps/site/components/portal-prewarm.tsx`: `export function PortalPrewarm() { return null; }`.

`apps/site/app/not-found.tsx`: copy the portal's current `not-found.tsx` (it already renders the marketing `SiteHeader`, which now lives in this app).

`apps/site/app/sitemap.ts` replaces the deleted route handler. It uses a static metadata route, which `output: 'export'` writes to `out/sitemap.xml`:

```ts
import type { MetadataRoute } from 'next';

import appConfig from '@kit/brand/config/app';

import { SITEMAP_ROUTES } from '~/config/site-navigation.config';

export const dynamic = 'force-static';

/**
 * Derived from `SITEMAP_ROUTES`, never a literal list:
 * `site-navigation.routes.test.ts` asserts this file still reads it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return SITEMAP_ROUTES.map((path) => ({
    url: new URL(path, appConfig.url).href,
    lastModified,
  }));
}
```

In `apps/site/app/robots.ts`, change the import to `@kit/brand/config/app` and add `export const dynamic = 'force-static';`.

- [ ] **Step 3: Update the routes test to the new sitemap file**

In `apps/site/config/site-navigation.routes.test.ts`:
- Wherever `SITEMAP_ROUTE_FILE` is built from `'sitemap.xml', 'route.ts'`, build it from `'sitemap.ts'` instead.
- Rename the test `'derives app/sitemap.xml/route.ts from SITEMAP_ROUTES'` to `'derives app/sitemap.ts from SITEMAP_ROUTES'`. Keep its assertion that the file mentions `SITEMAP_ROUTES`, and that it contains no literal `'/…'` route array.
- The test walks `app/(marketing)` relative to its own file, and the relative location is unchanged, so nothing else needs editing.

Run `pnpm --filter site test:unit`. Expected: PASS, with the same count the portal had for these two files.

- [ ] **Step 4: Give the portal its own root page, 404 and error header**

`apps/portal/components/portal-header.tsx`:

```tsx
import { AppLogo } from '@kit/brand/app-logo';

/** The portal's error pages are not part of the public site, so a logo home is enough. */
export function PortalHeader() {
  return (
    <header className={'border-b px-4 py-3'}>
      <AppLogo href={'/'} label={'Home Page'} eager />
    </header>
  );
}
```

In `apps/portal/app/not-found.tsx`, `error.tsx` and `global-error.tsx`, replace the import of `SiteHeader` from `~/(marketing)/_components/site-header` with `PortalHeader` from `~/components/portal-header`, and `<SiteHeader />` with `<PortalHeader />`.

`apps/portal/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

import appConfig from '@kit/brand/config/app';

/**
 * The router never sends "/" to the portal. This exists only for `pnpm dev`,
 * where the portal runs on its own port and a logo click should still reach
 * the public site.
 */
export default function PortalRoot() {
  redirect(appConfig.url);
}
```

Remove MDX from `apps/portal/next.config.mjs`: delete the `createMDX` import and wrapper, `pageExtensions`, `turbopack.resolveExtensions`, `experimental.mdxRs` and the `outputFileTracingIncludes` block (no `content/` directory exists). Export `withNextIntl(config)`. Remove `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `@types/mdx` and `next-sitemap` from `apps/portal/package.json`.

Update `apps/e2e/tests/public-site/public-site.spec.ts` to import from `'../../../site/config/site-navigation.config'`.

- [ ] **Step 5: Build both apps**

```bash
pnpm install
pnpm --filter site build
ls apps/site/out | head -30
test -f apps/site/out/404.html && test -f apps/site/out/sitemap.xml && test -f apps/site/out/robots.txt && echo OK
grep -rn "use cache\|cacheLife\|next/headers" apps/site/app apps/site/components apps/site/lib || echo "no request-time APIs"
pnpm --filter portal build
pnpm typecheck && pnpm lint && pnpm format
pnpm --filter site test:unit && pnpm --filter portal test:unit
```

Expected:
- `out/` has `index.html`, `who-we-are.html`, `faith-in-action/…`, `404.html`, `sitemap.xml` and `robots.txt`, and the script prints `OK` and `no request-time APIs`.
- The portal builds with no marketing routes.

If the site build fails on a page, the failure names the request-time API it hit. Remove that API from the page; don't add it to the site config.

- [ ] **Step 6: Commit**

```bash
git add -A apps/site apps/portal apps/e2e pnpm-lock.yaml
git commit -m "feat(site): serve the public site as a static export"
```

---

### Task 4: Portal links from the static site, and the split guard

**Files:**
- Create: `apps/site/lib/portal-href.ts`, `apps/site/lib/portal-href.test.ts`, `apps/site/components/site-link.tsx`
- Modify: `apps/site/mdx-components.tsx` (the `a` mapping), every portal link in `apps/site/app/(marketing)/_components/*.tsx`, `.oxlintrc.json`, `apps/site/.env` (document `NEXT_PUBLIC_PORTAL_URL`)

**Interfaces:**
- Consumes: `isPortalPath` from `@kit/brand/config/paths`.
- Produces: `portalHref(href: string, portalUrl?: string): string` and `<SiteLink href className? …anchorProps>`. Task 9 relies on portal links rendering as a plain `<a href>` whose path passes `isPortalPath`.

- [ ] **Step 1: Write the failing test**

`apps/site/lib/portal-href.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { portalHref } from './portal-href';

describe('portalHref', () => {
  it('leaves portal links relative in production (same origin)', () => {
    expect(portalHref('/auth/sign-in?next=/home/checkout')).toBe(
      '/auth/sign-in?next=/home/checkout',
    );
  });

  it('prefixes portal links with the dev portal URL, keeping the query', () => {
    expect(
      portalHref('/auth/sign-in?next=/home/checkout', 'http://localhost:3001'),
    ).toBe('http://localhost:3001/auth/sign-in?next=/home/checkout');
  });

  it('never prefixes site links', () => {
    expect(portalHref('/who-we-are', 'http://localhost:3001')).toBe(
      '/who-we-are',
    );
    expect(portalHref('/homework', 'http://localhost:3001')).toBe('/homework');
  });

  it('leaves external and fragment links alone', () => {
    expect(portalHref('https://kofc.org', 'http://localhost:3001')).toBe(
      'https://kofc.org',
    );
    expect(portalHref('#main-content', 'http://localhost:3001')).toBe(
      '#main-content',
    );
  });

  it('tolerates a trailing slash on the portal URL', () => {
    expect(portalHref('/home', 'http://localhost:3001/')).toBe(
      'http://localhost:3001/home',
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter site test:unit -- lib/portal-href.test.ts`
Expected: FAIL, "Cannot find module './portal-href'".

- [ ] **Step 3: Implement**

`apps/site/lib/portal-href.ts`:

```ts
import { isPortalPath } from '@kit/brand/config/paths';

/**
 * In production the site and the portal share one origin, so a portal link
 * stays relative. In `pnpm dev` the portal runs on its own port, named by
 * NEXT_PUBLIC_PORTAL_URL, and portal links are sent there.
 */
export function portalHref(
  href: string,
  portalUrl: string | undefined = process.env.NEXT_PUBLIC_PORTAL_URL,
): string {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }

  const pathname = href.split(/[?#]/, 1)[0] ?? href;

  if (!portalUrl || !isPortalPath(pathname)) {
    return href;
  }

  return `${portalUrl.replace(/\/+$/, '')}${href}`;
}
```

`apps/site/components/site-link.tsx`:

```tsx
import Link from 'next/link';

import { isPortalPath } from '@kit/brand/config/paths';

import { portalHref } from '~/lib/portal-href';

type SiteLinkProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  href: string;
};

/**
 * A portal page is not part of this static export. `next/link` would try a
 * client-side transition and request an RSC payload that does not exist, so
 * portal links are plain anchors and do a full page load through the router.
 */
export function SiteLink({ href, ...props }: SiteLinkProps) {
  const pathname = href.split(/[?#]/, 1)[0] ?? href;

  if (href.startsWith('/') && isPortalPath(pathname)) {
    return <a href={portalHref(href)} {...props} />;
  }

  return <Link href={href} {...props} />;
}
```

- [ ] **Step 4: Use `SiteLink` everywhere the site links to the portal**

Find every candidate:

```bash
grep -rn -e "pathsConfig" -e "href={'/home" -e "href={'/auth" -e "href=\"/home" -e "href=\"/auth" -e "next/link" apps/site/app apps/site/mdx-components.tsx
```

- In `apps/site/mdx-components.tsx`, the `a` mapping currently chooses `next/link` for internal links. Route internal links through `SiteLink` instead, which covers the MDX dues link `/auth/sign-in?next=/home/checkout`.
- In `site-header-account-section.tsx`, both sign-in links (`render={<Link href={pathsConfig.auth.signIn} />}` and the mobile `DropdownMenuItem`) become `render={<SiteLink href={pathsConfig.auth.signIn} />}`.
- Anywhere else the grep finds a `next/link` whose href passes `isPortalPath`, switch it to `SiteLink`.
- `PersonalAccountDropdown` (from `@kit/accounts`) links internally with `next/link`. Leave it. In production a failed client transition falls back to a full navigation, and changing the package is out of scope.

- [ ] **Step 5: Add a render test for the full-page-load guarantee**

Append to `apps/site/lib/portal-href.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';

import { SiteLink } from '../components/site-link';

describe('SiteLink', () => {
  it('renders a portal link as a plain anchor with the portal href', () => {
    const html = renderToStaticMarkup(
      <SiteLink href={'/auth/sign-in?next=/home/checkout'}>Sign in</SiteLink>,
    );

    expect(html).toBe(
      '<a href="/auth/sign-in?next=/home/checkout">Sign in</a>',
    );
  });
});
```

Rename the file to `portal-href.test.tsx`, since it now contains JSX. Run `pnpm --filter site test:unit`. Expected: PASS.

- [ ] **Step 6: Add the split guard to oxlint**

In `.oxlintrc.json`, add:

```json
"overrides": [
  {
    "files": ["apps/site/**"],
    "rules": {
      "no-restricted-imports": [
        "error",
        {
          "paths": [
            { "name": "server-only", "message": "apps/site is a static export; server code belongs in apps/portal." },
            { "name": "next/headers", "message": "apps/site is a static export; there is no request." }
          ],
          "patterns": [
            { "group": ["@kit/supabase/server*", "@kit/supabase/*-server-client*"], "message": "apps/site is a static export; use the browser client only." }
          ]
        }
      ]
    }
  }
]
```

Check the rule fires: temporarily add `import 'server-only';` to `apps/site/lib/portal-href.ts` and run `pnpm lint`. Expected: an error naming `no-restricted-imports`. Remove the line and run `pnpm lint` again. Expected: clean.

- [ ] **Step 7: Document the dev variable, verify and commit**

Add to `apps/site/.env`:

```
# Portal origin for `pnpm dev` only (portal on its own port). Unset in production: one origin.
NEXT_PUBLIC_PORTAL_URL=http://localhost:3001
```

and set `NEXT_PUBLIC_PORTAL_URL=` (empty) in a new `apps/site/.env.production`, so production builds keep links relative.

```bash
pnpm --filter site build && pnpm typecheck && pnpm lint && pnpm format && pnpm --filter site test:unit
grep -o 'href="[^"]*auth/sign-in[^"]*"' apps/site/out/get-involved/pay-dues.html
```

Expected: the grep prints `href="/auth/sign-in?next=/home/checkout"`, which is relative because the production env is used for the build.

```bash
git add -A apps/site .oxlintrc.json
git commit -m "feat(site): link to the portal with full page loads and forbid server imports"
```

---

### Task 5: Portal production image

**Files:**
- Modify: `apps/portal/next.config.mjs` (add `output: 'standalone'`, `assetPrefix`), `apps/portal/app/version/route.ts`, `apps/portal/package.json` (`dev` on port 3001)
- Create: `apps/portal/Dockerfile`, `.dockerignore` (repo root)

**Interfaces:**
- Produces: a Docker image listening on `$PORT` (default 8080) that serves the portal with static chunks under `/_next/static`, while HTML references them as `/portal-assets/_next/static/…`. The image honours the runtime env `GIT_HASH` and `ORIGIN_AUTH`, and takes the build args `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY` and `NEXT_PUBLIC_CI`.

- [ ] **Step 1: Configure the build**

In `apps/portal/next.config.mjs`, add to `config`:

```js
  /** Cloud Run runs `node server.js` from the standalone output. */
  output: 'standalone',
  /**
   * The public site also emits /_next/static. Prefixing the portal's asset
   * URLs keeps the two apart; the router strips the prefix before proxying,
   * so the server still serves the files at /_next/static.
   */
  assetPrefix: '/portal-assets',
```

In `apps/portal/package.json`, change `"dev"` to `"pnpm with-env next dev --port 3001 | pino-pretty -c"`, so `pnpm dev` runs the site on 3000 and the portal on 3001.

- [ ] **Step 2: Make `/version` read only `GIT_HASH`**

In `apps/portal/app/version/route.ts`, replace `KNOWN_GIT_ENV_VARS` and its comment with:

```ts
// Set by the deploy workflow (`--set-env-vars GIT_HASH=…`) and by compose.yaml.
const KNOWN_GIT_ENV_VARS = ['GIT_HASH'];
```

- [ ] **Step 3: Write the Dockerfile**

`.dockerignore` (repo root):

```
**/node_modules
**/.next
**/out
**/.turbo
.pnpm-store
.git
**/.env.local
**/test-results
**/playwright-report
```

`apps/portal/Dockerfile`:

```dockerfile
# Build from the repo root: docker build -f apps/portal/Dockerfile .
FROM node:24-slim AS base
RUN npm install -g pnpm@11.18.0 turbo@2.10.8

FROM base AS prune
WORKDIR /repo
COPY . .
RUN turbo prune portal --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN CI=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CAPTCHA_SITE_KEY=""
ARG NEXT_PUBLIC_CI=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CAPTCHA_SITE_KEY=$NEXT_PUBLIC_CAPTCHA_SITE_KEY \
    NEXT_PUBLIC_CI=$NEXT_PUBLIC_CI \
    NEXT_TELEMETRY_DISABLED=1
RUN cd apps/portal && pnpm exec next build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /repo/apps/portal/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build --chown=node:node /repo/apps/portal/public ./apps/portal/public
USER node
EXPOSE 8080
CMD ["node", "apps/portal/server.js"]
```

- [ ] **Step 4: Build and smoke-test the image**

```bash
docker build -f apps/portal/Dockerfile \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY apps/portal/.env.development | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  --build-arg NEXT_PUBLIC_CI=true \
  -t kofc-portal:local .
docker run --rm -d -p 8080:8080 -e GIT_HASH=smoke -e ORIGIN_AUTH=local --name portal-smoke kofc-portal:local
sleep 3
curl -s -H 'X-Origin-Auth: local' http://localhost:8080/version; echo
curl -s -H 'X-Origin-Auth: local' http://localhost:8080/auth/sign-in | grep -o '/portal-assets/_next/static/[^"]*' | head -1
docker rm -f portal-smoke
```

Expected:
- The build succeeds, confirming `turbo prune` handles the pnpm 11 catalogs.
- `/version` prints `smoke`.
- The sign-in HTML references a `/portal-assets/_next/static/…` chunk.

`ORIGIN_AUTH` has no effect until Task 6.

If `turbo prune` fails on the lockfile, replace the prune stage with a full `COPY . .` and install, and note it in the commit message. The image gets larger but stays correct.

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm format && pnpm --filter portal test:unit
git add -A apps/portal .dockerignore
git commit -m "feat(portal): build a standalone image with prefixed assets"
```

---

### Task 6: Origin lock

**Files:**
- Create: `apps/portal/lib/origin-lock.ts`, `apps/portal/lib/origin-lock.test.ts`
- Modify: `apps/portal/proxy.ts`

**Interfaces:**
- Produces: `checkOriginAuth(presented: string | null, secret: string | undefined, nodeEnv: string | undefined): 'allow' | 'deny' | 'misconfigured'`. `proxy.ts` returns 404 for `deny` and 500 for `misconfigured`.

- [ ] **Step 1: Write the failing test**

`apps/portal/lib/origin-lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { checkOriginAuth } from './origin-lock';

describe('checkOriginAuth', () => {
  it('allows the matching secret', () => {
    expect(checkOriginAuth('s3cret', 's3cret', 'production')).toBe('allow');
  });

  it('denies a missing header', () => {
    expect(checkOriginAuth(null, 's3cret', 'production')).toBe('deny');
  });

  it('denies a wrong or prefix-only value', () => {
    expect(checkOriginAuth('nope', 's3cret', 'production')).toBe('deny');
    expect(checkOriginAuth('s3cre', 's3cret', 'production')).toBe('deny');
    expect(checkOriginAuth('s3cretX', 's3cret', 'production')).toBe('deny');
  });

  it('fails closed when production has no secret configured', () => {
    expect(checkOriginAuth('anything', undefined, 'production')).toBe(
      'misconfigured',
    );
    expect(checkOriginAuth(null, '', 'production')).toBe('misconfigured');
  });

  it('allows everything in development when no secret is set (pnpm dev)', () => {
    expect(checkOriginAuth(null, undefined, 'development')).toBe('allow');
  });

  it('still enforces a secret in development when one is set (local stack)', () => {
    expect(checkOriginAuth(null, 'local', 'development')).toBe('deny');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter portal test:unit -- lib/origin-lock.test.ts`
Expected: FAIL, "Cannot find module './origin-lock'".

- [ ] **Step 3: Implement**

`apps/portal/lib/origin-lock.ts`:

```ts
/**
 * Cloud Run's *.run.app URL is public, so the portal only answers requests
 * that came through the Cloudflare router, which adds X-Origin-Auth. A
 * production process without the secret refuses everything rather than
 * silently serving unlocked.
 *
 * The comparison is constant-time over the secret's length, so response
 * timing does not reveal how much of a guess was right.
 */
export function checkOriginAuth(
  presented: string | null,
  secret: string | undefined,
  nodeEnv: string | undefined,
): 'allow' | 'deny' | 'misconfigured' {
  if (!secret) {
    return nodeEnv === 'production' ? 'misconfigured' : 'allow';
  }

  if (presented === null || presented.length !== secret.length) {
    return 'deny';
  }

  let difference = 0;

  for (let index = 0; index < secret.length; index++) {
    difference |= presented.charCodeAt(index) ^ secret.charCodeAt(index);
  }

  return difference === 0 ? 'allow' : 'deny';
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter portal test:unit -- lib/origin-lock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into `proxy.ts`**

In `apps/portal/proxy.ts`:
- Widen the matcher so `/api/*` (webhooks) is covered too:

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|images|locales|assets).*)'],
};
```

- At the very top of `proxy()`, before `NextResponse.next()`:

```ts
  const originAuth = checkOriginAuth(
    request.headers.get('x-origin-auth'),
    process.env.ORIGIN_AUTH,
    process.env.NODE_ENV,
  );

  if (originAuth === 'misconfigured') {
    return new NextResponse('Origin lock not configured', { status: 500 });
  }

  if (originAuth === 'deny') {
    return new NextResponse(null, { status: 404 });
  }
```

- Add `import { checkOriginAuth } from '~/lib/origin-lock';`.

- [ ] **Step 6: Verify against the real image**

```bash
pnpm --filter portal test:unit && pnpm typecheck && pnpm lint && pnpm format
docker build -f apps/portal/Dockerfile --build-arg NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY apps/portal/.env.development | cut -d= -f2-)" \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 --build-arg NEXT_PUBLIC_CI=true -t kofc-portal:local .
docker run --rm -d -p 8080:8080 -e ORIGIN_AUTH=local -e GIT_HASH=x --name portal-smoke kofc-portal:local; sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/version
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/api/webhooks/stripe
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Origin-Auth: local' http://localhost:8080/version
docker rm -f portal-smoke
docker run --rm -d -p 8080:8080 --name portal-smoke kofc-portal:local; sleep 3
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Origin-Auth: local' http://localhost:8080/version
docker rm -f portal-smoke
```

Expected: `404`, `404`, `200`, then `500` (production image with no secret).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/origin-lock.ts apps/portal/lib/origin-lock.test.ts apps/portal/proxy.ts
git commit -m "feat(portal): only answer requests carrying the router's origin secret"
```

---

### Task 7: Router Worker, including proxying, the 404 page and redirect rewriting

**Files:**
- Create: `apps/router/package.json`, `apps/router/tsconfig.json`, `apps/router/wrangler.jsonc`, `apps/router/vitest.config.ts`, `apps/router/src/env.ts`, `apps/router/src/routing.ts`, `apps/router/src/routing.test.ts`, `apps/router/src/forward.ts`, `apps/router/src/forward.test.ts`, `apps/router/src/index.ts`, `apps/router/src/index.test.ts`

**Interfaces:**
- Consumes: `isPortalPath` from `@kit/brand/config/paths` (Task 2), and the site's `out/` directory (Task 3).
- Produces:
  - `Env { ASSETS: Fetcher; PORTAL_ORIGIN: string; ORIGIN_AUTH: string; SIMULATE_COLD_START_MS?: string; SIMULATE_IDLE_MS?: string }`
  - `routing.ts`:
    - `classify(url: URL): 'portal' | 'site'`
    - `pleaseWaitEligible(request: Request, url: URL): boolean`. Task 8 fills in the body; this task defines it returning `false`.
  - `forward.ts`:
    - `buildOriginRequest(request: Request, env: Env): Request`
    - `rewriteLocation(response: Response, portalOrigin: string, publicOrigin: string): Response`
  - `index.ts` default export `{ fetch(request, env, ctx) }`

- [ ] **Step 1: Scaffold the package**

`apps/router/package.json`:

```json
{
  "name": "router",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 3000",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@kit/brand": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "latest",
    "@cloudflare/workers-types": "latest",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "wrangler": "^4"
  }
}
```

After `pnpm install`, replace `latest` with the versions pnpm resolved, so the lockfile is stable. Add `workerd: true` under `allowBuilds` in `pnpm-workspace.yaml`.

`@cloudflare/vitest-pool-workers` must support the repo's Vitest major (4.x). If `pnpm install` reports a peer conflict, give the router its own `vitest` version with a comment explaining why, rather than changing the catalog.

`apps/router/tsconfig.json`:

```json
{
  "extends": "@kit/tsconfig/base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "tsBuildInfoFile": "node_modules/.cache/tsbuildinfo.json"
  },
  "include": ["src"]
}
```

(Add `"@kit/tsconfig": "workspace:*"` to devDependencies.)

`apps/router/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kofc-router",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-25",
  "assets": {
    "directory": "../site/out",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  },
  // PORTAL_ORIGIN is set per environment with --var at deploy time.
  // ORIGIN_AUTH is a secret: `wrangler secret put ORIGIN_AUTH`.
  "vars": { "PORTAL_ORIGIN": "" },
  // Attaching the real domain is Cutover step 4. Until then, deploys run
  // without --env and traffic stays on *.workers.dev.
  "env": {
    "production": {
      "routes": [{ "pattern": "kofc-15256.org", "custom_domain": true }],
      "vars": { "PORTAL_ORIGIN": "" }
    }
  }
}
```

`apps/router/vitest.config.ts`:

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            PORTAL_ORIGIN: 'https://portal-abc.a.run.app',
            ORIGIN_AUTH: 'test-secret',
          },
        },
      },
    },
  },
});
```

The asset directory must exist for tests, so run `pnpm --filter site build` once first. Task 12's CI does this before `test:unit`.

`apps/router/src/env.ts`:

```ts
export interface Env {
  ASSETS: Fetcher;
  PORTAL_ORIGIN: string;
  ORIGIN_AUTH: string;
  /** Local stack only: pretend the portal is cold for this many ms. */
  SIMULATE_COLD_START_MS?: string;
  /** Local stack only: how long without portal traffic counts as idle. */
  SIMULATE_IDLE_MS?: string;
}
```

- [ ] **Step 2: Write the failing routing test**

`apps/router/src/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { classify } from './routing';

const at = (path: string) => new URL(path, 'https://kofc-15256.org');

describe('classify', () => {
  it.each(['/home', '/home/', '/auth/sign-in', '/api/webhooks/stripe', '/version', '/update-password', '/portal-assets/_next/static/a.js'])(
    'sends %s to the portal',
    (path) => expect(classify(at(path))).toBe('portal'),
  );

  it.each(['/', '/homework', '/authors', '/api-docs', '/versions', '/who-we-are', '/nope'])(
    'keeps %s on the site',
    (path) => expect(classify(at(path))).toBe('site'),
  );
});
```

- [ ] **Step 3: Run it, implement `routing.ts`, run it again**

Run: `pnpm --filter router test:unit -- src/routing.test.ts`. Expected: FAIL (module missing).

`apps/router/src/routing.ts`:

```ts
import { isPortalPath } from '@kit/brand/config/paths';

export function classify(url: URL): 'portal' | 'site' {
  return isPortalPath(url.pathname) ? 'portal' : 'site';
}

/** Filled in by the cold-start task; until then no request gets the waiting page. */
export function pleaseWaitEligible(_request: Request, _url: URL): boolean {
  return false;
}
```

Run again. Expected: PASS, 14 tests.

- [ ] **Step 4: Write the failing forwarding tests**

These cover Review Focus 2, 3, 4 and 5. `apps/router/src/forward.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';

const env = {
  PORTAL_ORIGIN: 'https://portal-abc.a.run.app',
  ORIGIN_AUTH: 'test-secret',
} as Env;

describe('buildOriginRequest', () => {
  it('targets the portal origin, keeping path and query', () => {
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/auth/sign-in?next=/home/checkout'),
      env,
    );

    expect(origin.url).toBe(
      'https://portal-abc.a.run.app/auth/sign-in?next=/home/checkout',
    );
  });

  it('strips /portal-assets before proxying', () => {
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/portal-assets/_next/static/chunks/a.js?v=1'),
      env,
    );

    expect(origin.url).toBe(
      'https://portal-abc.a.run.app/_next/static/chunks/a.js?v=1',
    );
  });

  it('adds the origin secret and forwarded headers, and overwrites a spoofed secret', () => {
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/home', {
        headers: { 'x-origin-auth': 'forged', cookie: 'sb=1' },
      }),
      env,
    );

    expect(origin.headers.get('x-origin-auth')).toBe('test-secret');
    expect(origin.headers.get('x-forwarded-host')).toBe('kofc-15256.org');
    expect(origin.headers.get('x-forwarded-proto')).toBe('https');
    expect(origin.headers.get('cookie')).toBe('sb=1');
    expect(origin.redirect).toBe('manual');
  });

  it('forwards a binary body byte-for-byte with its method and content type', async () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    const origin = buildOriginRequest(
      new Request('https://kofc-15256.org/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'stripe-signature': 't=1,v1=abc' },
        body: bytes,
      }),
      env,
    );

    expect(origin.method).toBe('POST');
    expect(origin.headers.get('stripe-signature')).toBe('t=1,v1=abc');
    expect(new Uint8Array(await origin.arrayBuffer())).toEqual(bytes);
  });
});

describe('rewriteLocation', () => {
  it('rewrites a redirect on the portal origin to the public origin, keeping path and query', () => {
    const response = rewriteLocation(
      new Response(null, {
        status: 307,
        headers: { location: 'https://portal-abc.a.run.app/auth/sign-in?next=/home' },
      }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://kofc-15256.org/auth/sign-in?next=/home',
    );
  });

  it('leaves relative and third-party redirects alone', () => {
    const relative = rewriteLocation(
      new Response(null, { status: 302, headers: { location: '/home' } }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );
    const external = rewriteLocation(
      new Response(null, { status: 303, headers: { location: 'https://checkout.stripe.com/x' } }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(relative.headers.get('location')).toBe('/home');
    expect(external.headers.get('location')).toBe('https://checkout.stripe.com/x');
  });

  it('keeps every Set-Cookie header', () => {
    const headers = new Headers({ location: 'https://portal-abc.a.run.app/home' });
    headers.append('set-cookie', 'sb-access=a; Path=/; HttpOnly');
    headers.append('set-cookie', 'sb-refresh=b; Path=/; HttpOnly');

    const response = rewriteLocation(
      new Response(null, { status: 302, headers }),
      env.PORTAL_ORIGIN,
      'https://kofc-15256.org',
    );

    expect(response.headers.getSetCookie()).toEqual([
      'sb-access=a; Path=/; HttpOnly',
      'sb-refresh=b; Path=/; HttpOnly',
    ]);
  });
});
```

- [ ] **Step 5: Run it, implement `forward.ts`, run it again**

Run: `pnpm --filter router test:unit -- src/forward.test.ts`. Expected: FAIL (module missing).

`apps/router/src/forward.ts`:

```ts
import type { Env } from './env';

const ASSET_PREFIX = '/portal-assets';

/**
 * The request the portal receives. The method, headers and body stream
 * through untouched, because Stripe and Square sign the raw body. Redirects
 * are not followed, so the browser sees the portal's own redirect.
 */
export function buildOriginRequest(request: Request, env: Env): Request {
  const incoming = new URL(request.url);
  const target = new URL(env.PORTAL_ORIGIN);

  target.pathname = incoming.pathname.startsWith(`${ASSET_PREFIX}/`)
    ? incoming.pathname.slice(ASSET_PREFIX.length)
    : incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.set('x-origin-auth', env.ORIGIN_AUTH);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

/**
 * The portal builds absolute redirects from the Host it received, which
 * behind the router is the Cloud Run host. That host is origin-locked, so
 * any Location pointing at it is moved to the public origin.
 */
export function rewriteLocation(
  response: Response,
  portalOrigin: string,
  publicOrigin: string,
): Response {
  const location = response.headers.get('location');

  if (!location) {
    return response;
  }

  let target: URL;

  try {
    target = new URL(location);
  } catch {
    return response;
  }

  if (target.origin !== new URL(portalOrigin).origin) {
    return response;
  }

  const rewritten = new URL(
    `${target.pathname}${target.search}${target.hash}`,
    publicOrigin,
  );
  const copy = new Response(response.body, response);
  copy.headers.set('location', rewritten.href);

  return copy;
}
```

Run again. Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing handler test**

`apps/router/src/index.test.ts`:

```ts
import { SELF, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('router', () => {
  it('serves a site page from the static assets without touching the portal', async () => {
    const response = await SELF.fetch('https://kofc-15256.org/who-we-are');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html');
  });

  it('serves the static 404 page for an unknown non-portal path', async () => {
    const response = await SELF.fetch('https://kofc-15256.org/homework');

    expect(response.status).toBe(404);
  });

  it('proxies a portal path and rewrites its redirect', async () => {
    fetchMock
      .get('https://portal-abc.a.run.app')
      .intercept({ path: '/home' })
      .reply(307, '', {
        headers: { location: 'https://portal-abc.a.run.app/auth/sign-in?next=/home' },
      });

    const response = await SELF.fetch('https://kofc-15256.org/home', {
      redirect: 'manual',
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://kofc-15256.org/auth/sign-in?next=/home',
    );
  });
});
```

- [ ] **Step 7: Run it, implement `index.ts`, run it again**

Run: `pnpm --filter router test:unit -- src/index.test.ts`. Expected: FAIL (no default export).

`apps/router/src/index.ts`:

```ts
import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';
import { classify } from './routing';

async function proxyToPortal(request: Request, env: Env): Promise<Response> {
  const response = await fetch(buildOriginRequest(request, env));

  return rewriteLocation(response, env.PORTAL_ORIGIN, new URL(request.url).origin);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Static files never reach here: Workers static assets answers a
    // matching file before the Worker runs. What arrives is either a portal
    // path or a miss, and a miss gets the site's 404 page without waking
    // Cloud Run.
    if (classify(url) === 'site') {
      return env.ASSETS.fetch(request);
    }

    return proxyToPortal(request, env);
  },
} satisfies ExportedHandler<Env>;
```

Run again. Expected: PASS, 3 tests. Then run `pnpm --filter router typecheck`.

- [ ] **Step 8: Commit**

```bash
git add -A apps/router pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(router): serve the site and proxy portal paths to Cloud Run"
```

---

### Task 8: Cold-start "Please wait..." page

**Files:**
- Create: `apps/site/lib/wait-for-portal.ts`, `apps/site/lib/wait-for-portal.test.ts`, `apps/site/app/please-wait/page.tsx`, `apps/site/app/please-wait/please-wait-client.tsx`, `apps/router/src/cold-start.ts`, `apps/router/src/cold-start.test.ts`
- Modify: `apps/router/src/routing.ts` (`pleaseWaitEligible`), `apps/router/src/routing.test.ts`, `apps/router/src/index.ts`, `apps/router/src/index.test.ts`

Deviation from the spec: the spec says `SIMULATE_COLD_START_MS` "delays every proxied response". Taken literally, the waiting page would reload into another delayed response forever. The simulation instead delays only the first portal request after `SIMULATE_IDLE_MS` (default 60000) without portal traffic, which is what a real cold start does.

**Interfaces:**
- Consumes: `Env`, `classify`, `buildOriginRequest` and `rewriteLocation` (Task 7).
- Produces:
  - `waitForPortal(deps: { fetchVersion: () => Promise<number>; sleep: (ms: number) => Promise<void>; now: () => number; intervalMs?: number; timeoutMs?: number }): Promise<'ready' | 'timeout'>`
  - `pleaseWaitEligible(request: Request, url: URL): boolean`
  - `ColdStartSimulator` with `delayFor(now: number): number` and `markWarm(now: number): void`
  - the static page `/please-wait` (`out/please-wait.html`)

- [ ] **Step 1: Write the failing eligibility test**

Append to `apps/router/src/routing.test.ts`:

```ts
import { pleaseWaitEligible } from './routing';

const navigation = (path: string, init: RequestInit = {}) => {
  const request = new Request(`https://kofc-15256.org${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    ...init,
  });

  return [request, new URL(request.url)] as const;
};

describe('pleaseWaitEligible', () => {
  it('accepts an HTML GET navigation to a portal page', () => {
    expect(pleaseWaitEligible(...navigation('/home/members'))).toBe(true);
    expect(pleaseWaitEligible(...navigation('/auth/sign-in?next=/home'))).toBe(true);
  });

  it.each(['/auth/callback?code=abc', '/auth/confirm?token_hash=x'])(
    'never interrupts one-time-code route %s',
    (path) => expect(pleaseWaitEligible(...navigation(path))).toBe(false),
  );

  it('never interrupts a POST, server action or webhook', () => {
    expect(pleaseWaitEligible(...navigation('/home', { method: 'POST' }))).toBe(false);
  });

  it('never interrupts assets or non-HTML requests', () => {
    expect(pleaseWaitEligible(...navigation('/portal-assets/_next/static/a.js'))).toBe(false);
    const [request, url] = navigation('/version', { headers: { accept: '*/*' } });
    expect(pleaseWaitEligible(request, url)).toBe(false);
  });
});
```

Run: `pnpm --filter router test:unit -- src/routing.test.ts`. Expected: FAIL (stub returns `false` for the first case).

- [ ] **Step 2: Implement eligibility**

Replace the stub in `apps/router/src/routing.ts`:

```ts
/** Routes carrying a one-time code: an abandoned first request could spend it. */
const NEVER_INTERRUPT = ['/auth/callback', '/auth/confirm'];

export function pleaseWaitEligible(request: Request, url: URL): boolean {
  if (request.method !== 'GET') return false;
  if (!(request.headers.get('accept') ?? '').includes('text/html')) return false;
  if (url.pathname.startsWith('/portal-assets/')) return false;

  return !NEVER_INTERRUPT.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
  );
}
```

Run again. Expected: PASS.

- [ ] **Step 3: Write the failing simulator test**

`apps/router/src/cold-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ColdStartSimulator } from './cold-start';

describe('ColdStartSimulator', () => {
  it('delays the first request, then nothing while warm', () => {
    const simulator = new ColdStartSimulator(5000, 60000);

    expect(simulator.delayFor(1000)).toBe(5000);
    simulator.markWarm(6000);
    expect(simulator.delayFor(7000)).toBe(0);
  });

  it('goes cold again after the idle window', () => {
    const simulator = new ColdStartSimulator(5000, 60000);

    simulator.markWarm(0);
    expect(simulator.delayFor(60001)).toBe(5000);
  });

  it('is off when no delay is configured', () => {
    expect(new ColdStartSimulator(0, 60000).delayFor(0)).toBe(0);
  });
});
```

Run it. Expected: FAIL (module missing).

- [ ] **Step 4: Implement the simulator**

`apps/router/src/cold-start.ts`:

```ts
/**
 * Local stack only. A real Cloud Run cold start happens once, after an idle
 * period; delaying every request instead would make the waiting page reload
 * into another wait forever. State is per Worker isolate, which in
 * `wrangler dev` means one for the whole session.
 */
export class ColdStartSimulator {
  private lastWarmAt: number | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly idleMs: number,
  ) {}

  delayFor(now: number): number {
    if (this.delayMs <= 0) return 0;
    if (this.lastWarmAt !== null && now - this.lastWarmAt <= this.idleMs) return 0;

    return this.delayMs;
  }

  markWarm(now: number): void {
    this.lastWarmAt = now;
  }
}
```

Run it. Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing polling test**

`apps/site/lib/wait-for-portal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { waitForPortal } from './wait-for-portal';

function fakeClock() {
  let time = 0;

  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe('waitForPortal', () => {
  it('is ready as soon as /version returns 200', async () => {
    const clock = fakeClock();
    const statuses = [503, 503, 200];

    const result = await waitForPortal({
      ...clock,
      fetchVersion: async () => statuses.shift() ?? 200,
    });

    expect(result).toBe('ready');
    expect(clock.now()).toBe(2000);
  });

  it('treats a network error as not ready yet', async () => {
    const clock = fakeClock();
    let calls = 0;

    const result = await waitForPortal({
      ...clock,
      fetchVersion: async () => {
        calls++;
        if (calls === 1) throw new TypeError('network');
        return 200;
      },
    });

    expect(result).toBe('ready');
  });

  it('gives up after 30 seconds', async () => {
    const clock = fakeClock();

    const result = await waitForPortal({ ...clock, fetchVersion: async () => 503 });

    expect(result).toBe('timeout');
    expect(clock.now()).toBeGreaterThanOrEqual(30000);
  });
});
```

Run: `pnpm --filter site test:unit -- lib/wait-for-portal.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 6: Implement polling**

`apps/site/lib/wait-for-portal.ts`:

```ts
export async function waitForPortal({
  fetchVersion,
  sleep,
  now,
  intervalMs = 1000,
  timeoutMs = 30000,
}: {
  fetchVersion: () => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<'ready' | 'timeout'> {
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    try {
      if ((await fetchVersion()) === 200) return 'ready';
    } catch {
      // The container is still starting; keep polling.
    }

    await sleep(intervalMs);
  }

  return 'timeout';
}
```

Run it. Expected: PASS, 3 tests.

- [ ] **Step 7: Build the page**

`apps/site/app/please-wait/please-wait-client.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

import { Button } from '@kit/ui/button';
import { Spinner } from '@kit/ui/spinner';

import { waitForPortal } from '~/lib/wait-for-portal';

/**
 * Served by the router in place of a portal page while Cloud Run starts. The
 * address bar still shows the page the visitor asked for, so reloading goes
 * straight back to it, query string included.
 */
export function PleaseWaitClient() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void waitForPortal({
      fetchVersion: async () =>
        (await fetch('/version', { cache: 'no-store' })).status,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    }).then((result) => {
      if (cancelled) return;
      if (result === 'ready') window.location.reload();
      else setTimedOut(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={'flex flex-col items-center gap-4 py-24'} role={'status'}>
      {timedOut ? (
        <Button onClick={() => window.location.reload()}>Try again</Button>
      ) : (
        <>
          <Spinner />
          <p className={'text-muted-foreground text-lg'}>Please wait...</p>
        </>
      )}
    </div>
  );
}
```

If `@kit/ui` has no `spinner` export (`ls packages/ui/src/shadcn | grep -i spin`), use `lucide-react`'s `Loader2` with `className="animate-spin"` instead.

`apps/site/app/please-wait/page.tsx`:

```tsx
import type { Metadata } from 'next';

import { SiteHeader } from '~/(marketing)/_components/site-header';

import { PleaseWaitClient } from './please-wait-client';

export const metadata: Metadata = {
  title: 'Please wait...',
  robots: { index: false, follow: false },
};

export default function PleaseWaitPage() {
  return (
    <div className={'flex min-h-screen flex-col'}>
      <SiteHeader />
      <main className={'container flex-1'}>
        <PleaseWaitClient />
      </main>
    </div>
  );
}
```

Exclude `/please-wait` from the site's route-integrity sweep. In `apps/site/config/site-navigation.config.ts`, find the list of unlisted-but-real routes that `site-navigation.routes.test.ts` checks, add `'/please-wait'` to it, and make sure it is not in `SITEMAP_ROUTES`. Run `pnpm --filter site test:unit`. Expected: PASS.

- [ ] **Step 8: Write the failing race test**

Append to `apps/router/src/index.test.ts`:

```ts
it('shows Please wait... when a portal navigation is slower than 1.5 s', async () => {
  fetchMock
    .get('https://portal-abc.a.run.app')
    .intercept({ path: '/home/members?tab=all' })
    .reply(200, '<html>members</html>')
    .delay(2500);

  const response = await SELF.fetch('https://kofc-15256.org/home/members?tab=all', {
    headers: { accept: 'text/html' },
  });

  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('2');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toContain('Please wait...');
});

it('returns the portal page when it answers within 1.5 s', async () => {
  fetchMock
    .get('https://portal-abc.a.run.app')
    .intercept({ path: '/home' })
    .reply(200, '<html>home</html>');

  const response = await SELF.fetch('https://kofc-15256.org/home', {
    headers: { accept: 'text/html' },
  });

  expect(response.status).toBe(200);
  expect(await response.text()).toContain('home');
});

it('makes a slow auth callback wait instead of showing Please wait...', async () => {
  fetchMock
    .get('https://portal-abc.a.run.app')
    .intercept({ path: '/auth/callback?code=abc' })
    .reply(302, '', { headers: { location: '/home' } })
    .delay(2500);

  const response = await SELF.fetch('https://kofc-15256.org/auth/callback?code=abc', {
    headers: { accept: 'text/html' },
    redirect: 'manual',
  });

  expect(response.status).toBe(302);
});
```

Run: `pnpm --filter router test:unit -- src/index.test.ts`. Expected: the first new test FAILS (gets 200 after waiting).

- [ ] **Step 9: Implement the race**

Replace `apps/router/src/index.ts`:

```ts
import { ColdStartSimulator } from './cold-start';
import type { Env } from './env';
import { buildOriginRequest, rewriteLocation } from './forward';
import { classify, pleaseWaitEligible } from './routing';

const PLEASE_WAIT_AFTER_MS = 1500;

let simulator: ColdStartSimulator | null = null;

function getSimulator(env: Env): ColdStartSimulator {
  simulator ??= new ColdStartSimulator(
    Number(env.SIMULATE_COLD_START_MS ?? 0),
    Number(env.SIMULATE_IDLE_MS ?? 60000),
  );

  return simulator;
}

async function proxyToPortal(request: Request, env: Env): Promise<Response> {
  const cold = getSimulator(env);
  const delay = cold.delayFor(Date.now());

  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const response = await fetch(buildOriginRequest(request, env));
  cold.markWarm(Date.now());

  return rewriteLocation(response, env.PORTAL_ORIGIN, new URL(request.url).origin);
}

async function pleaseWait(request: Request, env: Env): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/please-wait', request.url));

  return new Response(page.body, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': '2',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (classify(url) === 'site') {
      return env.ASSETS.fetch(request);
    }

    const portal = proxyToPortal(request, env);

    if (!pleaseWaitEligible(request, url)) {
      return portal;
    }

    const TIMED_OUT = Symbol('timed-out');
    const winner = await Promise.race([
      portal,
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), PLEASE_WAIT_AFTER_MS),
      ),
    ]);

    if (winner !== TIMED_OUT) {
      return winner;
    }

    // Let the original request finish: it is what warms the container.
    ctx.waitUntil(portal.then((response) => response.body?.cancel()).catch(() => {}));

    return pleaseWait(request, env);
  },
} satisfies ExportedHandler<Env>;
```

Run: `pnpm --filter router test:unit`. Expected: all router tests PASS. Then run `pnpm --filter router typecheck`.

- [ ] **Step 10: Commit**

```bash
pnpm --filter site build && pnpm typecheck && pnpm lint && pnpm format
git add -A apps/router apps/site
git commit -m "feat: show Please wait... while the portal container starts"
```

---

### Task 9: Pre-warm the portal from the site

Deviation from the spec: the spec says `HEAD /version`. Next.js route handlers do not implement `HEAD` automatically, so the pre-warm uses `GET` (the response is a few bytes).

**Files:**
- Create: `apps/site/lib/prewarm.ts`, `apps/site/lib/prewarm.test.ts`
- Modify: `apps/site/components/portal-prewarm.tsx` (replace the Task 3 stub)

**Interfaces:**
- Consumes: `isPortalPath` from `@kit/brand/config/paths`.
- Produces: `createPrewarmer({ fetchVersion, pageOrigin }): (href: string | null) => void`, which calls `fetchVersion` at most once per instance, and only for a same-origin portal link.

- [ ] **Step 1: Write the failing test**

`apps/site/lib/prewarm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { createPrewarmer } from './prewarm';

const origin = 'https://kofc-15256.org';

describe('createPrewarmer', () => {
  it('warms once for the first portal link, then never again', () => {
    const fetchVersion = vi.fn();
    const prewarm = createPrewarmer({ fetchVersion, pageOrigin: origin });

    prewarm('/auth/sign-in?next=/home/checkout');
    prewarm('/home');

    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it('ignores site links, look-alikes, other origins and missing hrefs', () => {
    const fetchVersion = vi.fn();
    const prewarm = createPrewarmer({ fetchVersion, pageOrigin: origin });

    prewarm('/who-we-are');
    prewarm('/homework');
    prewarm('https://kofc.org/home');
    prewarm(null);

    expect(fetchVersion).not.toHaveBeenCalled();
  });

  it('warms for an absolute link on this origin', () => {
    const fetchVersion = vi.fn();
    createPrewarmer({ fetchVersion, pageOrigin: origin })(`${origin}/home`);

    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm --filter site test:unit -- lib/prewarm.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

`apps/site/lib/prewarm.ts`:

```ts
import { isPortalPath } from '@kit/brand/config/paths';

/**
 * Starts the portal container during the moment between a visitor pointing
 * at a portal link and clicking it. At most one request per page view: the
 * first one wakes the container, and more would only add load.
 */
export function createPrewarmer({
  fetchVersion,
  pageOrigin,
}: {
  fetchVersion: () => void;
  pageOrigin: string;
}): (href: string | null) => void {
  let warmed = false;

  return (href) => {
    if (warmed || !href) return;

    let url: URL;

    try {
      url = new URL(href, pageOrigin);
    } catch {
      return;
    }

    if (url.origin !== pageOrigin || !isPortalPath(url.pathname)) return;

    warmed = true;
    fetchVersion();
  };
}
```

Run it. Expected: PASS, 3 tests.

- [ ] **Step 3: Wire the component**

`apps/site/components/portal-prewarm.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

import { createPrewarmer } from '~/lib/prewarm';

export function PortalPrewarm() {
  useEffect(() => {
    const prewarm = createPrewarmer({
      pageOrigin: window.location.origin,
      fetchVersion: () => {
        void fetch('/version', { cache: 'no-store' }).catch(() => {});
      },
    });

    const onIntent = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      prewarm(anchor?.getAttribute('href') ?? null);
    };

    const events = ['pointerover', 'focusin', 'touchstart'] as const;
    events.forEach((name) =>
      document.addEventListener(name, onIntent, { passive: true }),
    );

    return () =>
      events.forEach((name) => document.removeEventListener(name, onIntent));
  }, []);

  return null;
}
```

In `pnpm dev`, portal links are absolute to port 3001, so the origin check skips them and pre-warming is effectively off in dev. That's fine, because there is no cold start in dev.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter site test:unit && pnpm --filter site build && pnpm typecheck && pnpm lint && pnpm format
git add -A apps/site
git commit -m "feat(site): warm the portal when a visitor points at a portal link"
```

---

### Task 10: Local Docker stack

**Files:**
- Create: `compose.yaml`, `apps/router/Dockerfile.dev`
- Modify: root `package.json` (the `stack:up` and `stack:down` scripts), `apps/portal/.env.development` (unchanged values; the compose file reads it)

**Interfaces:**
- Consumes: the portal image (Task 5), the router (Tasks 7–8), and the site build (Task 3).
- Produces: `pnpm stack:up` serves the whole site at `http://localhost:3000`, with local Supabase from `pnpm supabase:web:start`. `SIMULATE_COLD_START_MS=5000 pnpm stack:up` turns on the cold-start simulation.

- [ ] **Step 1: Router dev image**

`apps/router/Dockerfile.dev`:

```dockerfile
# Build from the repo root: docker build -f apps/router/Dockerfile.dev .
FROM node:24-slim AS base
RUN npm install -g pnpm@11.18.0 turbo@2.10.8

FROM base AS prune
WORKDIR /repo
COPY . .
RUN turbo prune router site --docker

FROM base AS run
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
RUN CI=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
    NEXT_PUBLIC_PORTAL_URL= \
    NEXT_TELEMETRY_DISABLED=1
RUN cd apps/site && pnpm exec next build
WORKDIR /repo/apps/router
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec wrangler dev --ip 0.0.0.0 --port 3000 --var PORTAL_ORIGIN:http://portal:8080 --var ORIGIN_AUTH:local-stack --var SIMULATE_COLD_START_MS:${SIMULATE_COLD_START_MS:-0}"]
```

- [ ] **Step 2: Compose file**

`compose.yaml`:

```yaml
# Production-like local stack: `pnpm stack:up`, then http://localhost:3000.
# Supabase is NOT in here. It is the CLI-managed stack
# (`pnpm supabase:web:start`), reached from the containers via
# host.docker.internal.
name: kofc

x-supabase-public: &supabase-public
  NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${LOCAL_SUPABASE_ANON_KEY}

services:
  portal:
    build:
      context: .
      dockerfile: apps/portal/Dockerfile
      args:
        <<: *supabase-public
        NEXT_PUBLIC_SITE_URL: http://localhost:3000
        NEXT_PUBLIC_CI: 'true'
    env_file: apps/portal/.env.development
    environment:
      ORIGIN_AUTH: local-stack
      GIT_HASH: local
    extra_hosts:
      - host.docker.internal:host-gateway

  # The browser reaches Supabase at 127.0.0.1:54321 on the host. The portal's
  # server code uses the same baked-in URL, so inside the portal's network
  # namespace this sidecar makes 127.0.0.1:54321 lead to the host's Supabase.
  supabase-bridge:
    image: alpine/socat:1.8.0.3
    network_mode: service:portal
    command: TCP-LISTEN:54321,fork,reuseaddr TCP:host.docker.internal:54321
    depends_on: [portal]

  router:
    build:
      context: .
      dockerfile: apps/router/Dockerfile.dev
      args: *supabase-public
    environment:
      SIMULATE_COLD_START_MS: ${SIMULATE_COLD_START_MS:-0}
    ports:
      - '3000:3000'
    depends_on: [portal]
```

`network_mode: service:portal` gives the sidecar the portal's network namespace but not its `extra_hosts`. If `host.docker.internal` doesn't resolve inside the sidecar, add the same `extra_hosts` entry to the portal service; the shared namespace uses the portal's `/etc/hosts`.

- [ ] **Step 3: Scripts**

Root `package.json` `scripts`:

```json
"stack:up": "LOCAL_SUPABASE_ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' apps/portal/.env.development | cut -d= -f2-) docker compose up --build --detach && echo 'Stack at http://localhost:3000'",
"stack:down": "docker compose down"
```

- [ ] **Step 4: Run it end to end**

```bash
pnpm supabase:web:start
pnpm stack:up
sleep 20
curl -s -o /dev/null -w 'site %{http_code}\n' http://localhost:3000/
curl -s -o /dev/null -w '404 %{http_code}\n' http://localhost:3000/homework
curl -s http://localhost:3000/version; echo
curl -s -o /dev/null -w 'sign-in %{http_code}\n' http://localhost:3000/auth/sign-in
curl -s -o /dev/null -w 'members %{http_code} -> %{redirect_url}\n' http://localhost:3000/home/members
pnpm stack:down
SIMULATE_COLD_START_MS=5000 pnpm stack:up; sleep 20
curl -s -H 'accept: text/html' http://localhost:3000/auth/sign-in | grep -c 'Please wait...'
pnpm stack:down
```

Expected:
- `site 200`, `404 404` and `local`.
- `sign-in 200`.
- `members 307 -> http://localhost:3000/auth/sign-in?next=/home/members`, with the host rewritten.
- With the simulation on, a count of `1`.

Then sign in through a browser at http://localhost:3000 with a seeded user. That shows the Supabase bridge works for both the browser and the server.

- [ ] **Step 5: Commit**

```bash
git add compose.yaml apps/router/Dockerfile.dev package.json
git commit -m "feat: run the whole site locally with docker compose"
```

---

### Task 11: E2E against the local stack, including cold start

**Files:**
- Create: `apps/e2e/tests/cold-start/cold-start.spec.ts`
- Modify: `apps/e2e/playwright.config.ts` (ignore the cold-start suite unless enabled)

**Interfaces:**
- Consumes: `pnpm stack:up` (Task 10). `baseURL` stays `http://localhost:3000`.

- [ ] **Step 1: Gate the suite**

In `apps/e2e/playwright.config.ts`, set:

```ts
  /* The cold-start suite needs a stack started with SIMULATE_COLD_START_MS. */
  testIgnore: process.env.E2E_COLD_START === 'true' ? [] : ['**/cold-start/**'],
```

- [ ] **Step 2: Write the test**

`apps/e2e/tests/cold-start/cold-start.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * Needs `SIMULATE_COLD_START_MS=5000 pnpm stack:up` on a stack that has been
 * idle for over a minute (or was just started), and E2E_COLD_START=true.
 */
test('a cold portal shows Please wait..., then the requested page with its query', async ({ page }) => {
  await page.goto('/auth/sign-in?next=/home/checkout');

  await expect(page.getByText('Please wait...')).toBeVisible();
  await expect(page.getByText('Please wait...')).toBeHidden({ timeout: 20_000 });

  expect(page.url()).toContain('/auth/sign-in?next=/home/checkout');
  await expect(page.locator('input[type="email"]')).toBeVisible();
});
```

- [ ] **Step 3: Run the suites**

```bash
pnpm supabase:web:start
pnpm stack:up && sleep 20
pnpm --filter web-e2e test
pnpm stack:down
SIMULATE_COLD_START_MS=5000 pnpm stack:up && sleep 20
E2E_COLD_START=true pnpm --filter web-e2e exec playwright test tests/cold-start
pnpm stack:down
```

Expected:
- The existing suites pass against the stack: public-site, authentication, account, members and rbac.
- The cold-start test passes.

If a suite fails, fix the cause (usually a hard-coded `localhost:3000` portal URL, or a portal link rendered with `next/link` on the site). Don't loosen the test.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e
git commit -m "test(e2e): run against the compose stack and cover the cold-start page"
```

---

### Task 12: CI checks, deploy workflow and cloud setup scripts

The agent writes these files and does not run the cloud commands. The user runs `infra/gcp/setup.sh` and sets the GitHub secrets.

**Files:**
- Modify: `.github/workflows/workflow.yml` (add unit tests and the site build)
- Create: `.github/workflows/deploy.yml`, `infra/gcp/setup.sh`

**Interfaces:**
- Consumes: the portal Dockerfile (Task 5), the router (Tasks 7–8) and the site build (Task 3).
- Produces: these GitHub repository **variables**: `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`, `PORTAL_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_CAPTCHA_SITE_KEY`. And these **secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 1: Extend CI checks**

In `.github/workflows/workflow.yml`'s `typescript` job, after `Lint`, add:

```yaml
      - name: Build static site (split guard)
        run: pnpm --filter site build
        env:
          NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder

      - name: Unit tests
        run: pnpm turbo test:unit
```

The site build runs before the unit tests, because the router's tests serve its `out/` directory.

- [ ] **Step 2: Deploy workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  workflow_run:
    workflows: [Workflow]
    types: [completed]
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  portal:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-latest
    env:
      IMAGE: us-east4-docker.pkg.dev/${{ vars.GCP_PROJECT_ID }}/portal/portal
      SHA: ${{ github.event.workflow_run.head_sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker us-east4-docker.pkg.dev --quiet
      - name: Build and push
        run: |
          docker build -f apps/portal/Dockerfile \
            --build-arg NEXT_PUBLIC_SUPABASE_URL=${{ vars.NEXT_PUBLIC_SUPABASE_URL }} \
            --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ vars.NEXT_PUBLIC_SUPABASE_ANON_KEY }} \
            --build-arg NEXT_PUBLIC_SITE_URL=https://kofc-15256.org \
            --build-arg NEXT_PUBLIC_CAPTCHA_SITE_KEY=${{ vars.NEXT_PUBLIC_CAPTCHA_SITE_KEY }} \
            -t "$IMAGE:$SHA" .
          docker push "$IMAGE:$SHA"
      - name: Deploy to Cloud Run
        run: |
          DIGEST=$(gcloud artifacts docker images describe "$IMAGE:$SHA" --format='value(image_summary.digest)')
          gcloud run deploy portal \
            --image "$IMAGE@$DIGEST" \
            --region us-east4 \
            --service-account ${{ vars.GCP_RUNTIME_SA }} \
            --min-instances 0 --max-instances 3 \
            --cpu 1 --memory 1Gi --cpu-throttling \
            --timeout 300 \
            --allow-unauthenticated \
            --set-env-vars GIT_HASH=$SHA \
            --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,ORIGIN_AUTH=origin-auth:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,SQUARE_ACCESS_TOKEN=square-access-token:latest,SQUARE_WEBHOOK_SIGNATURE_KEY=square-webhook-signature-key:latest

  router:
    needs: portal
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter site build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ vars.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ vars.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          NEXT_PUBLIC_SITE_URL: https://kofc-15256.org
      - run: pnpm --filter router exec wrangler deploy --var PORTAL_ORIGIN:${{ vars.PORTAL_ORIGIN }}
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Before writing the `--set-secrets` list, check the portal's real env var names:

```bash
grep -rhoE "process\.env\.[A-Z_]+" apps/portal packages | sort -u
```

Keep only the server-only ones (no `NEXT_PUBLIC_`). Each gets one Secret Manager secret, named in lowercase kebab-case.

The workflow deploys without `--env`, so the custom domain in `wrangler.jsonc`'s `env.production` (Task 7) stays detached until Cutover step 4. At that point the runbook switches this step to `wrangler deploy --env production`. Secrets are per environment, so `wrangler secret put ORIGIN_AUTH --env production` is needed then too.

- [ ] **Step 3: GCP one-time setup script**

`infra/gcp/setup.sh`:

```bash
#!/usr/bin/env bash
# One-time Google Cloud setup for the portal. Idempotent: safe to re-run.
# Run it yourself (it changes shared cloud state):  PROJECT_ID=... ./infra/gcp/setup.sh
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION=us-east4
REPO=ninglima/st-louis-martin-kofc
POOL=github
PROVIDER=github-main

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com iam.googleapis.com

gcloud artifacts repositories describe portal --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create portal --repository-format docker --location "$REGION"

for SA in portal-runtime portal-deploy; do
  gcloud iam service-accounts describe "$SA@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$SA"
done
RUNTIME_SA="portal-runtime@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOY_SA="portal-deploy@$PROJECT_ID.iam.gserviceaccount.com"

for ROLE in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" --role "$ROLE" --condition None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/iam.serviceAccountUser >/dev/null

gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location global
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
    --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL" --location global --format 'value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$REPO" >/dev/null

# Secrets: created empty here; add values with
#   printf '%s' "$VALUE" | gcloud secrets versions add NAME --data-file=-
for SECRET in supabase-service-role-key origin-auth stripe-secret-key stripe-webhook-secret square-access-token square-webhook-signature-key; do
  gcloud secrets describe "$SECRET" >/dev/null 2>&1 || gcloud secrets create "$SECRET" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "GitHub variables:"
echo "  GCP_PROJECT_ID=$PROJECT_ID"
echo "  GCP_WIF_PROVIDER=$POOL_ID/providers/$PROVIDER"
echo "  GCP_DEPLOY_SA=$DEPLOY_SA"
echo "  GCP_RUNTIME_SA=$RUNTIME_SA"
```

Match the secret list to the names found in Step 2's grep. Run `chmod +x infra/gcp/setup.sh` and `bash -n infra/gcp/setup.sh`. Expected: no syntax errors.

- [ ] **Step 4: Validate the workflows offline, then commit**

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color
git add .github infra apps/router/wrangler.jsonc
git commit -m "ci: deploy the portal to Cloud Run and the site and router to Cloudflare"
```

Expected: actionlint reports no errors.

---

### Task 13: Cleanup and the runbook

**Files:**
- Modify: `README.md`, `.npmrc`, `.gitignore`
- Untrack: `.idea/awsToolkit.xml`
- Create: `docs/runbook/hosting.md`

- [ ] **Step 1: Remove dead config**

- `.npmrc`: pnpm 11 ignores its non-auth settings. `node_modules/.modules.yaml` records `publicHoistPattern: []` despite the three `public-hoist-pattern` lines. Delete those lines, and any other setting pnpm 11 ignores. Run `CI=true pnpm install --frozen-lockfile && pnpm typecheck` to confirm nothing depended on them. If the file ends up empty, delete it.
- `git rm --cached .idea/awsToolkit.xml`, then add `.idea/awsToolkit.xml` to `.gitignore`.
- `README.md`: replace MakerKit's "Deploy to Vercel", "Deploy to Cloudflare" and "Deployment Options" (Railway) sections with one short "Hosting" section. It should describe the three apps, the `pnpm dev` and `pnpm stack:up` modes, and link to `docs/runbook/hosting.md`.

- [ ] **Step 2: Write the runbook**

`docs/runbook/hosting.md` must contain the following. Use real commands, not placeholders; each item comes straight from the spec.

1. **Local development:**
   - `pnpm supabase:web:start`, then `pnpm dev` (site on 3000, portal on 3001).
   - `pnpm stack:up` / `pnpm stack:down`.
   - `SIMULATE_COLD_START_MS=5000 pnpm stack:up` for the cold-start simulation.
2. **One-time setup:**
   - `PROJECT_ID=… ./infra/gcp/setup.sh`
   - Adding each secret value with `gcloud secrets versions add`
   - Setting the GitHub variables and secrets listed in Task 12
   - Creating the Cloudflare API token (Workers Scripts: Edit on the account)
   - `pnpm --filter router exec wrangler secret put ORIGIN_AUTH`, with the same value as the `origin-auth` secret
   - After the first portal deploy, setting `PORTAL_ORIGIN` to `gcloud run services describe portal --region us-east4 --format 'value(status.url)'`
3. **Migrations:** the Supabase GitHub integration applies them on merge to `main`. Every migration must be backward-compatible (add first, remove in a later deploy).
4. **Rollback:**
   - `gcloud run services update-traffic portal --region us-east4 --to-revisions=<previous>=100`
   - `pnpm --filter router exec wrangler rollback`
   - Migrations: write a forward fix.
5. **Rotating `ORIGIN_AUTH`:** add a new secret version, run `wrangler secret put ORIGIN_AUTH`, then redeploy the portal. Expect a brief window of 404s between the two steps.
6. **Cutover checklist:**
   - Prerequisites: GCP billing upgraded from the trial; Supabase upgraded to Pro.
   - At merge, change the Supabase GitHub integration's working directory from `apps/web` to `apps/portal`, then confirm the next migration applies.
   - Deploy to `*.workers.dev` and smoke-test it: a public page loads; `/version` returns the commit; sign-in completes a round trip; a Stripe test webhook returns 2xx.
   - Add `https://kofc-15256.org` and the workers.dev URL to the Supabase auth redirect URLs.
   - Register the webhook endpoints `https://kofc-15256.org/api/webhooks/{stripe,square}`.
   - Switch the deploy to `wrangler deploy --env production`, which attaches the custom domain.
   - Keep WordPress running, unrouted, for two weeks.

- [ ] **Step 3: Final verification and commit**

```bash
CI=true pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format && pnpm turbo test:unit
pnpm --filter site build && pnpm --filter portal build
git add -A README.md .npmrc .gitignore docs/runbook .idea
git commit -m "docs: hosting runbook and removal of template deploy leftovers"
```

Expected: everything passes.
