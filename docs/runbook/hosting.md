# Hosting runbook

The council website is split into three deployable apps:

- **`apps/site`** — the static marketing site. Built with `next build` (static
  export) and served as static assets by the Cloudflare Worker in
  `apps/router`.
- **`apps/portal`** — the authenticated Next.js application (sign-in, gated
  pages, APIs, webhooks). Deployed as a container to Google Cloud Run, scaling
  to zero when idle.
- **`apps/router`** — a Cloudflare Worker that serves `apps/site`'s static
  assets directly and proxies portal paths (`/auth`, `/home`, `/api`,
  `/version`, `/update-password`, `/portal-assets`) to the Cloud Run service.

`packages/brand` holds config shared by all three (including the list of
portal path prefixes the router proxies).

This document is for whoever deploys and operates this stack. It gives exact
commands, in the order you need them. The only things you fill in yourself are
your GCP project ID and secret values — everything else is copy-paste.

## 1. Local development

Start Supabase once, then run the apps directly:

```bash
pnpm supabase:web:start
pnpm dev
```

`pnpm dev` runs every app in the workspace in parallel. The site is at
[http://localhost:3000](http://localhost:3000) and the portal is at
[http://localhost:3001](http://localhost:3001). In this mode the router is not
in the loop, so portal-only paths (`/auth`, `/home`, etc.) are reached
directly on port 3001.

To exercise the full production-like stack (router in front of the portal,
both built as containers, single origin on port 3000):

```bash
pnpm stack:up
# ... work against http://localhost:3000 ...
pnpm stack:down
```

`pnpm stack:up` builds and starts `docker compose` services for the portal and
router (Supabase is not containerized — the containers reach your
CLI-managed Supabase instance via `host.docker.internal`, so run
`pnpm supabase:web:start` first).

To simulate the portal's Cloud Run cold start (e.g. to check the router's
"please wait" page):

```bash
SIMULATE_COLD_START_MS=5000 pnpm stack:up
```

### Testing

```bash
pnpm turbo test:unit
pnpm --filter web-e2e test
```

For the cold-start e2e suite specifically:

```bash
E2E_COLD_START=true pnpm --filter web-e2e test
```

Known pre-existing failures — these fail identically on `main` and are not
regressions to chase down: the three account specs and the password-reset
spec fail because Mailpit's message-delete endpoint returns `405` and the
account specs expect a password session to already exist after an
email-confirmation sign-in.

## 2. One-time setup

Do these once, before the first deploy. Order matters: GitHub's `PORTAL_ORIGIN`
variable can only be set after the portal's first deploy, so the first merge
to `main` deploys the portal with the router's `PORTAL_ORIGIN` still unset,
and a second step (2.4 below) closes the loop once the portal's URL exists.

### 2.1. Google Cloud

```bash
GITHUB_REPOSITORY_ID=$(gh api repos/ninglima/st-louis-martin-kofc --jq .id) \
  PROJECT_ID=<your-gcp-project-id> ./infra/gcp/setup.sh
```

This is idempotent — safe to re-run. It enables the required APIs, creates the
Artifact Registry repo, the `portal-runtime` and `portal-deploy` service
accounts, the Workload Identity Federation pool/provider scoped to
`ninglima/st-louis-martin-kofc` on `refs/heads/main`, and the three empty
Secret Manager secrets. It prints the values you need for the GitHub
variables below.

The provider's condition pins the repository's numeric ID
(`GITHUB_REPOSITORY_ID`) as well as its name, so a repository that later
reclaims the name after a rename or transfer cannot deploy. Re-running the
script does **not** update a provider that already exists; in that case it
prints the `gcloud iam workload-identity-pools providers update-oidc` command
that applies the current mapping and condition, for you to run.

Every secret needs at least one version before the first deploy — the deploy
workflow mounts each as `NAME:latest`, and that fails if the secret has no
version yet. Add each value:

```bash
printf '%s' "<supabase-service-role-key-value>" | gcloud secrets versions add supabase-service-role-key --data-file=-
printf '%s' "<origin-auth-value>" | gcloud secrets versions add origin-auth --data-file=-
printf '%s' "<captcha-secret-token-value>" | gcloud secrets versions add captcha-secret-token --data-file=-
```

`origin-auth` is a value you generate yourself (e.g. `openssl rand -hex 32`)
— it is a shared secret between the router and the portal, not something
issued by a third party. Remember the value: you'll set the same value as the
router's `ORIGIN_AUTH` Worker secret in step 2.3.

Stripe and Square keys are **not** environment secrets — the portal reads
them from the `payment_config` table, not `process.env`. There is nothing to
add to Secret Manager for them.

### 2.2. GitHub repository variables and secrets

In the repo's Settings → Secrets and variables → Actions, set:

Repository **variables**:

- `GCP_PROJECT_ID` — printed by `setup.sh`
- `GCP_WIF_PROVIDER` — printed by `setup.sh`
  (`projects/<num>/locations/global/workloadIdentityPools/github/providers/github-main`)
- `GCP_DEPLOY_SA` — printed by `setup.sh` (`portal-deploy@<project>.iam.gserviceaccount.com`)
- `GCP_RUNTIME_SA` — printed by `setup.sh` (`portal-runtime@<project>.iam.gserviceaccount.com`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_CAPTCHA_SITE_KEY` (may be left empty)
- `PORTAL_ORIGIN` — **cannot be set yet.** This is the Cloud Run service URL,
  which does not exist until the portal has been deployed once. Skip it for
  now; step 2.4 below comes back to it. Until it is set, the `router` job in
  `deploy.yml` will deploy the router with an empty `PORTAL_ORIGIN`, so portal
  paths will return 500 until you set it and redeploy the router.

Repository **secrets**:

- `CLOUDFLARE_API_TOKEN` — see 2.3 for how to create it
- `CLOUDFLARE_ACCOUNT_ID`

### 2.3. Cloudflare

Create a custom API token (Cloudflare dashboard → My Profile → API Tokens →
Create Token → custom token) with these permissions:

- **Account** → Workers Scripts: Edit (your account) — deploys the Worker.
- **Zone** → Workers Routes: Edit, DNS: Edit, SSL and Certificates: Edit and
  Zone: Read, with Zone Resources set to the `kofc-15256.org` zone — needed at
  cutover (section 6), when `--env production` attaches the custom domain
  (Cloudflare creates the DNS record and certificate for it).

Put its value in the `CLOUDFLARE_API_TOKEN` GitHub secret above, and your
account ID in `CLOUDFLARE_ACCOUNT_ID`.

Local `wrangler secret put` commands (here and in sections 5 and 6) need local
Cloudflare auth: run `pnpm --filter router exec wrangler login` once, or export
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your shell.

Set the router's `ORIGIN_AUTH` secret to the same value you put in the
`origin-auth` GCP secret in step 2.1:

```bash
pnpm --filter router exec wrangler secret put ORIGIN_AUTH
```

(paste the same value when prompted). This sets the secret for the default
(`*.workers.dev`) environment. After cutover (section 6), Worker secrets are
per-environment, so this has to be set again with `--env production` — see
section 6.

### 2.4. First deploy and closing the loop on `PORTAL_ORIGIN`

The first deploy is the merge of the branch that renamed `apps/web` to
`apps/portal`. At (or just before) that merge:

- [ ] Change the Supabase GitHub integration's working directory from
      `apps/web` to `apps/portal` (Supabase dashboard → Project Settings →
      Integrations → GitHub). The migrations now live in
      `apps/portal/supabase`; with the old directory, new migrations silently
      stop being applied.
- [ ] After the merge, confirm the next migration applied (the integration's
      run for that merge succeeds, and the migration shows up in the hosted
      database).

Merge to `main` once with the variables above in place (`PORTAL_ORIGIN` still
unset). The `portal` job in `deploy.yml` builds and deploys the portal to
Cloud Run; the `router` job runs too, but deploys the router with an empty
`PORTAL_ORIGIN` (portal-proxied paths return 500 until the next step — the
static site itself is unaffected).

Once the portal has deployed at least once, get its URL:

```bash
gcloud run services describe portal --region us-east4 --format 'value(status.url)'
```

Set that URL as the `PORTAL_ORIGIN` repository variable in GitHub. The next
push to `main` (or a re-run of the `Deploy` workflow) will redeploy the router
with the real portal origin, and portal-proxied paths will work.

## 3. Migrations

The Supabase GitHub integration applies migrations automatically on merge to
`main` — there is no manual `db push` step in normal operation.

Every migration must be backward-compatible with the code currently running:
add columns/tables first, and only remove the old ones in a later, separate
deploy. Because the migration and the code deploy are not atomic (the
migration integration and the Cloud Run deploy are two independent systems),
a migration that immediately requires new code to be present would break the
window between the two.

The reverse holds too: new code must work before its migrations land. Dues
migrations deploy before or with the app; the app tolerates their absence
(`readDuesIfDeployed` in `@kit/dues/lib/dues-schema` renders the pages
without dues until the dues functions and tables exist).

## 4. Rollback

**Portal (Cloud Run):** shift traffic back to the previous revision:

```bash
gcloud run services update-traffic portal --region us-east4 --to-revisions=<previous-revision-name>=100
```

(List revisions with `gcloud run revisions list --service portal --region us-east4` to find `<previous-revision-name>`.)

**Router (Cloudflare Worker):**

```bash
pnpm --filter router exec wrangler rollback
```

(after cutover, add `--env production` — Worker deployments and rollbacks are
per-environment, same as the secrets in section 5).

**Migrations:** migrations are not rolled back. If a migration causes a
problem, write a forward-fixing migration rather than reverting — this is
why migrations must be backward-compatible in the first place.

## 5. Rotating `ORIGIN_AUTH`

`ORIGIN_AUTH` is the shared secret the router uses to prove to the portal that
a request came through the router (the portal rejects direct requests that
don't carry it). To rotate it:

```bash
printf '%s' "<new-value>" | gcloud secrets versions add origin-auth --data-file=-
pnpm --filter router exec wrangler secret put ORIGIN_AUTH
```

(paste the same new value when prompted), then redeploy the portal so it picks
up the new secret version (Cloud Run does not hot-reload mounted secrets):

```bash
gcloud run services update portal --region us-east4 --update-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,ORIGIN_AUTH=origin-auth:latest,CAPTCHA_SECRET_TOKEN=captcha-secret-token:latest
```

Expect a brief window of 404s between the two steps: the router starts
sending the new `ORIGIN_AUTH` value as soon as `wrangler secret put` completes,
but the portal is still running with the old value until it redeploys, so the
portal's origin lock rejects the router's requests until the Cloud Run update
finishes rolling out.

After cutover, run the `wrangler secret put ORIGIN_AUTH` step again with
`--env production` too (see section 6) — Worker secrets are per-environment,
so the default-environment secret and the production secret are two separate
values that both need to stay in sync with `origin-auth`.

## 6. Cutover checklist

Cutover is switching the custom domain (`kofc-15256.org`) from WordPress to
this stack. Do this once everything above has been running against
`*.workers.dev` and has been verified.

**Prerequisites:**

- [ ] GCP billing upgraded from the free trial (Cloud Run with a custom
      domain and sustained traffic needs a billing account past the trial).
- [ ] Supabase project upgraded to the Pro plan (the free tier pauses
      inactive projects and has lower rate limits than production traffic
      needs).

**Before switching the domain:**

- [ ] Confirm the Supabase GitHub integration's working directory is
      `apps/portal` (changed at the first deploy — see 2.4).
- [ ] Deploy to `*.workers.dev` and smoke-test it:
  - [ ] A public (site) page loads.
  - [ ] `/version` returns the deployed commit hash.
  - [ ] Sign-in completes a full round trip (sign in, land on a gated page).
  - [ ] A Stripe test webhook delivered to the deployed URL returns a 2xx.
- [ ] Add `https://kofc-15256.org` and the `*.workers.dev` URL to the
      Supabase project's auth redirect URLs (Supabase dashboard →
      Authentication → URL Configuration).
- [ ] Set the hosted Supabase project's **Site URL** to
      `https://kofc-15256.org` (same page: Authentication → URL
      Configuration). The auth email templates build every link from
      `{{ .SiteURL }}`, so until this is set, confirmation, magic-link,
      invite and password-reset emails link to the wrong host.
- [ ] Make sure the hosted project's email templates (Authentication → Email
      Templates) match the repo's `apps/portal/supabase/templates/*.html`.
      The files in the repo only configure the local Supabase; the hosted
      project keeps whatever was last pasted into the dashboard.
- [ ] Register the production webhook endpoints with Stripe and Square:
  - `https://kofc-15256.org/api/webhooks/stripe`
  - `https://kofc-15256.org/api/webhooks/square`

**Switch the domain:**

- [ ] **First**, set the Worker secret for the production environment
      (Worker secrets are per-environment; same value as the `origin-auth`
      GCP secret, pasted when prompted):

  ```bash
  pnpm --filter router exec wrangler secret put ORIGIN_AUTH --env production
  ```

  This must come before the production deploy: `secret put` creates the
  production Worker if it does not exist yet, so by the time the custom
  domain is attached the router already sends the real origin secret, never an
  empty one (which the portal would reject).

- [ ] **Then** switch CI to the production environment, which attaches the
      custom domain: in `.github/workflows/deploy.yml`, change the router
      job's deploy step to

  ```bash
  pnpm --filter router exec wrangler deploy --env production --var PORTAL_ORIGIN:${{ vars.PORTAL_ORIGIN }}
  ```

  and commit that to `main`. Do not run `wrangler deploy --env production`
  from your machine: it would publish whatever `apps/site/out` you last built
  locally instead of the site CI builds from `main`.

- [ ] Keep WordPress running, unrouted (not receiving traffic — e.g. DNS
      pointed away from it, but the server left up), for two weeks after
      cutover, in case a rollback of the domain itself is needed.
