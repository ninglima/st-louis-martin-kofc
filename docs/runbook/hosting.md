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

To see what is already in place, run the read-only check (it changes
nothing, prints OK or MISSING per item with the fix, and never prints secret
values):

```bash
./infra/preflight.sh
```

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
`ninglima/st-louis-martin-kofc` on `refs/heads/main`, and the six empty
Secret Manager secrets. It prints the values you need for the GitHub
variables below, and the command for each secret that still has no value.

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
printf '%s' "<dues-jobs-secret-value>" | gcloud secrets versions add dues-jobs-secret --data-file=-
printf '%s' "<resend-api-key-value>" | gcloud secrets versions add resend-api-key --data-file=-
printf '%s' "<resend-webhook-secret-value>" | gcloud secrets versions add resend-webhook-secret --data-file=-
```

`origin-auth` and `dues-jobs-secret` are values you generate yourself (e.g.
`openssl rand -hex 32`) — shared secrets between the router and the portal,
not something issued by a third party. Remember both: you'll set the same
values as the router's `ORIGIN_AUTH` and `DUES_JOBS_SECRET` Worker secrets in
step 2.3. Until email goes live (sections 7 and 8) the two Resend secrets may
hold a placeholder such as `unset`; the email modes default to `off`, so
nothing reads them. Once Turnstile is live, replace any placeholder in
`captcha-secret-token` with the Cloudflare Turnstile **secret** key and set
the matching site key on `NEXT_PUBLIC_CAPTCHA_SITE_KEY` (see 2.2).

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
- `NEXT_PUBLIC_CAPTCHA_SITE_KEY` — Cloudflare Turnstile **site** key for the
  invisible widget on `/auth/sign-in` (and other auth forms). Production value
  is already the live widget site key. Leave the committed `apps/portal/.env`
  empty for local e2e; put the site key in ignored `apps/portal/.env.local`
  for manual local testing. Pair with GCP secret `captcha-secret-token`
  (Turnstile **secret** key) and enable Turnstile under Supabase →
  Authentication → Attack Protection / Captcha (same keys), then redeploy
  the portal so the site key is baked into the image. Optional:
  `CAPTCHA_EXPECTED_HOSTNAMES` (comma-separated) for server-side siteverify
  hostname checks; defaults to the hostname of `NEXT_PUBLIC_SITE_URL`.
- `PORTAL_ORIGIN` — **cannot be set yet.** This is the Cloud Run service URL,
  which does not exist until the portal has been deployed once. Skip it for
  now; step 2.4 below comes back to it. Until it is set, the `router` job in
  `deploy.yml` fails on purpose instead of deploying a router whose portal
  paths would all return 500.

Optional repository **variables** (leave unset for the default):

- `SITE_URL` — the public origin baked into both builds (auth and email
  links). Default `https://kofc-15256.org`.
- `ROUTER_ENV` — leave unset until cutover; `production` deploys the Worker
  that owns the custom domain (section 6).
- `DUES_NOTICES_MODE`, `DUES_NOTICES_FROM`, `DUES_NOTICES_REPLY_TO`,
  `EVENT_EMAILS_MODE`, `EVENT_EMAILS_FROM`, `EVENT_EMAILS_REPLY_TO`,
  `EMAIL_ALLOWLIST` — sections 7 and 8. Both modes default to `off`.
  `EMAIL_ALLOWLIST` is a comma-separated list of addresses that may receive
  live mail; leave unset only when every eligible member should get email.

Changing a variable does not deploy anything by itself: run the Deploy
workflow afterwards (section 2.5).

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

Set the router's `ORIGIN_AUTH` and `DUES_JOBS_SECRET` secrets to the same
values you put in the `origin-auth` and `dues-jobs-secret` GCP secrets in step
2.1. Worker secrets are per-environment, so set each for the default
(`*.workers.dev`) Worker and for the production Worker that cutover uses
(section 6):

```bash
pnpm --filter router exec wrangler secret put ORIGIN_AUTH
pnpm --filter router exec wrangler secret put DUES_JOBS_SECRET
pnpm --filter router exec wrangler secret put ORIGIN_AUTH --env production
pnpm --filter router exec wrangler secret put DUES_JOBS_SECRET --env production
```

(paste the matching value when prompted). `secret put --env production`
creates the production Worker if it does not exist yet; it has no domain
until cutover.

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
Cloud Run; the `router` job then fails with "PORTAL_ORIGIN is not set". That
failure is expected.

Once the portal has deployed at least once, get its URL:

```bash
gcloud run services describe portal --region us-east4 --format 'value(status.url)'
```

Set that URL as the `PORTAL_ORIGIN` repository variable in GitHub, then run
the Deploy workflow (section 2.5). The router deploys to
`kofc-router.<account-subdomain>.workers.dev` with the real portal origin.

### 2.5. How deploys run

Every push to `main` runs the checks (`Workflow`); when they pass, `Deploy`
runs. Its `changes` job compares the commit with the last successfully
deployed one (`turbo ls --affected`, which follows workspace dependencies) and
deploys only what changed:

- the **portal** when `apps/portal` or any package it depends on changed
  (migrations under `apps/portal/supabase` count);
- the **router** when `apps/router` or `apps/site` (or a package either
  depends on) changed;
- **both** when there is no earlier successful deploy, when the lockfile or
  root config changed, or when `.github/workflows/deploy.yml` or `infra/`
  changed.

A docs-only merge deploys nothing. When both deploy, the router waits for the
portal and never deploys after a failed portal deploy.

To redeploy by hand — after changing a repository variable, for example — go
to Actions → Deploy → **Run workflow** on `main` (`force_all` deploys both),
or:

```bash
gh workflow run deploy.yml --ref main -f force_all=true
```

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
pnpm --filter router exec wrangler secret put ORIGIN_AUTH --env production
pnpm --filter router exec wrangler secret put ORIGIN_AUTH
```

(paste the same new value when prompted; the second command matters only
until the default Worker is deleted at cutover), then make the portal pick up
the new secret version (Cloud Run does not hot-reload mounted secrets):

```bash
gcloud run services update portal --region us-east4 --update-secrets ORIGIN_AUTH=origin-auth:latest
```

Expect a brief window of 404s between the two steps: the router starts
sending the new `ORIGIN_AUTH` value as soon as `wrangler secret put` completes,
but the portal is still running with the old value until it redeploys, so the
portal's origin lock rejects the router's requests until the Cloud Run update
finishes rolling out. `DUES_JOBS_SECRET` rotates the same way
(`dues-jobs-secret`, `wrangler secret put DUES_JOBS_SECRET --env production`,
`--update-secrets DUES_JOBS_SECRET=dues-jobs-secret:latest`).

## 6. Cutover checklist

Cutover is switching the custom domain (`kofc-15256.org`) from WordPress to
this stack. Do this once the stack is running on `*.workers.dev` (2.4) and
the smoke test below passes.

**Prerequisites:**

- [ ] GCP billing upgraded from the free trial, with a budget alert (Billing
      → Budgets & alerts; e.g. $10/month).
- [ ] Supabase project upgraded to the Pro plan (the free tier pauses
      inactive projects and has lower rate limits than production traffic
      needs).
- [ ] The `members_pii_key` Vault secret is backed up somewhere safe
      (`select decrypted_secret from vault.decrypted_secrets where name =
      'members_pii_key'` in the SQL editor). Without it, member personal
      data in a restored or moved database cannot be decrypted.
- [ ] `./infra/preflight.sh` reports nothing missing, including both
      production Worker secrets (2.3).

**Before switching the domain:**

- [ ] Confirm the Supabase GitHub integration's working directory is
      `apps/portal` (changed at the first deploy — see 2.4).
- [ ] Smoke-test `*.workers.dev`:
  - [ ] A public (site) page loads.
  - [ ] `/version` returns the deployed commit hash.
  - [ ] A first portal visit after the portal has been idle shows the
        "please wait" page, then the portal.
  - [ ] Sign-in completes a full round trip (sign in, land on a gated page).
  - [ ] A Stripe test webhook delivered to the deployed URL returns a 2xx.
  - [ ] `curl -X POST -H "Authorization: Bearer <dues-jobs-secret>"
        https://<workers.dev host>/api/jobs/dues-notices` returns 2xx (with
        the modes `off`, the run records mode `off`).
- [ ] Add `https://kofc-15256.org`, `https://kofc-15256.org/auth/callback`,
      `https://kofc-15256.org/update-password` and the `*.workers.dev` URL
      to the Supabase project's auth redirect URLs (Supabase dashboard →
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

**Switch the domain** (Cloudflare dashboard → the `kofc-15256.org` zone):

- [ ] In DNS → Records, write down, then **delete**, the `A`/`AAAA`/`CNAME`
      records for `kofc-15256.org` and `www` that point at WordPress. Leave
      `MX` and `TXT` records alone (they carry mail). A Worker custom domain
      cannot attach while another record exists for the same name.
- [ ] Set the repository variable `ROUTER_ENV` to `production` and run the
      Deploy workflow (2.5). The router deploys as the production Worker.
      Prefer **zone routes** on `kofc-15256.org` / `www` when apex DNS is
      already Cloudflare-proxied (`custom_domain` fails with error 100117
      until those A/AAAA/CNAME records are removed). Do not run
      `wrangler deploy --env production` from your machine unless you have
      just built `apps/site/out` from `main` — otherwise you publish a
      stale local site build.
- [ ] Redirect `www` to the apex. Static pages are answered before the
      Worker runs, so the Worker cannot do this:
  - DNS → Records: add `AAAA` `www` → `100::`, **Proxied**.
  - Rules → Redirect Rules → create from the "Redirect from WWW to root"
    template (301, preserve path and query string).
- [ ] Check: `curl -I https://kofc-15256.org/` is 200,
      `curl -I https://www.kofc-15256.org/who-we-are` is 301 to the apex
      path, `https://kofc-15256.org/version` shows the deployed commit.
- [ ] Register the production webhook endpoints with Stripe and Square:
  - `https://kofc-15256.org/api/webhooks/stripe`
  - `https://kofc-15256.org/api/webhooks/square`
- [ ] Delete the default (`*.workers.dev`) Worker. It carries the same daily
      cron, so leaving it up runs every job twice:

  ```bash
  pnpm --filter router exec wrangler delete --name kofc-router
  ```

- [ ] Keep WordPress running, unrouted (not receiving traffic — the DNS
      records above removed, but the server left up), for two weeks after
      cutover, in case a rollback of the domain itself is needed: restore
      the records you wrote down and run Deploy with `ROUTER_ENV` unset.

## 7. Dues notices

1. **Resend**
   - Register the webhook at `https://<site>/api/webhooks/resend` for the
     events `email.sent`, `email.delivered`, `email.delivery_delayed`,
     `email.bounced`, `email.complained`, `email.suppressed`,
     `email.failed`, `email.opened` and `email.clicked`.
   - Copy its signing secret (`whsec_…`).
   - Confirm that open and click tracking are on for the domain.
2. **Secret Manager.** Put the real values in `resend-api-key` and
   `resend-webhook-secret` (created by `setup.sh`, 2.1):

   ```bash
   printf '%s' "<re_…>" | gcloud secrets versions add resend-api-key --data-file=-
   printf '%s' "<whsec_…>" | gcloud secrets versions add resend-webhook-secret --data-file=-
   ```

   Set the repository variables `DUES_NOTICES_FROM` and (optionally)
   `DUES_NOTICES_REPLY_TO`, then run the Deploy workflow (2.5) so the portal
   picks them and the new secret versions up.

   The notice emails' "Pay dues" link is built from `NEXT_PUBLIC_SITE_URL`,
   and that value is **baked into the image at build time**: it is the
   `--build-arg NEXT_PUBLIC_SITE_URL=…` on the `docker build` step in
   `.github/workflows/deploy.yml` (the `SITE_URL` repository variable,
   default `https://kofc-15256.org`), not a Cloud Run env var. Setting it with
   `--set-env-vars` or in the Cloud Run console has no effect on the link
   (at runtime the server would otherwise fall back to the committed
   `apps/portal/.env`, which says `http://localhost:3000`). Confirm the build
   arg is the public https origin for this environment, and run Deploy
   (which rebuilds the image) if you change it. Live mode refuses to send — the run shows
   "Live mode needs NEXT_PUBLIC_SITE_URL to be the public https origin…" —
   when the built-in value is missing, not https, or a localhost /
   127.0.0.1 host.
3. **Worker.** `DUES_JOBS_SECRET` is already set on the Worker (2.3), with
   the same value as `dues-jobs-secret`. The cron
   `0 14 * * *` runs at 9 a.m. Central during daylight time and 8 a.m. in
   standard time.
4. **Going live**
   1. Set the repository variable `EMAIL_ALLOWLIST` to the E2E cohort
      addresses (comma-separated, e.g. your address first). While this is
      set, live mode sends only to those addresses; everyone else is
      skipped and never reaches Resend. Clear it only when the whole
      roster should receive mail.
   2. Set the repository variable `DUES_NOTICES_MODE` to `dry-run` and run
      Deploy (2.5). Leave it for a week.
   3. Check `/home/dues-notices`.
   4. Switch the variable to `live` and run Deploy again.
   5. `off` (or unsetting it) stops everything.
5. **Manual test send.** Officers with `finance.manage` see **Send a test
   notice** on `/home/dues-notices`. Pick a timing (30 days before, due date,
   or 30 days after), checkbox the members to include, and confirm. That
   claims live ledger rows and sends through Resend like the daily job:
   `EMAIL_ALLOWLIST` still applies, and a member can only receive each timing
   once per cycle (already-sent rows are disabled in the list). Timing can be
   forced even when today is outside that window.
6. **Deploy order.** Deploy the migration before or with the app. The pages
   show "Not available yet" until it has run.

## 8. Event emails

Volunteer events send members email. Everything shares the dues setup in
section 7: the same Resend account, webhook, API key and jobs secret.

1. **What gets sent**
   - **Confirmation.** After a member signs themselves up for a shift, with
     a calendar file (`event.ics`) attached. Officer walk-ins send nothing.
   - **Update or cancel.** When an event is cancelled or restored, its
     location changes, or a shift's start or end time changes. Each carries
     a fresh calendar file. At most one is waiting per sign-up, and the
     latest change wins. Title, description, lead, public-flag and type
     edits, and officer removals, send nothing.
   - **Reminder.** The morning before a shift, to members who have not
     turned reminders off on `/home/volunteering` and who have a primary
     email. No attachment.
   - Only active sign-ups on shifts that have not started are notified.
     Confirmations and change emails always send; only reminders can be
     switched off.
2. **Environment**
   - `EVENT_EMAILS_MODE`: `off` (default), `dry-run` or `live`.
   - `EVENT_EMAILS_FROM`, for example `Council Events <events@example.org>`.
     The sender domain must be verified in Resend.
   - `EVENT_EMAILS_REPLY_TO` (optional).
   - Reused from section 7: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
     `DUES_JOBS_SECRET`, the build-time `NEXT_PUBLIC_SITE_URL`, and
     `EMAIL_ALLOWLIST` (same allowlist gates event emails). Live mode
     refuses to send, and the run records why, when the API key or sender is
     missing or the site URL is not a public https origin.
   - Set these as repository variables and run Deploy (2.5);
     `deploy.yml` passes them to Cloud Run. No new secret is needed.
3. **Rollout**
   1. Deploy with `EVENT_EMAILS_MODE=off`. Nothing is sent or claimed.
   2. Switch to `dry-run` for a week. Rows are claimed and marked
      `dry_run`, which is final; Resend is never called. Nothing shows in
      the officer delivery badges while a row is a dry run.
   3. Switch to `live`. Sign yourself up for a test shift first, with your
      own address on your member record, and check the confirmation, the
      calendar file and the link.
   4. `off` stops everything again.
4. **Triggers.** Emails go out immediately after a sign-up or change. The
   same Worker cron as dues (`0 14 * * *`, about 9 a.m. Central in daylight
   time) also calls `POST /api/jobs/event-emails` to queue the next day's
   reminders and retry anything that failed. Run it by hand with
   `curl -X POST -H "Authorization: Bearer $DUES_JOBS_SECRET" https://<site>/api/jobs/event-emails`.
5. **Webhook.** The one Resend webhook from section 7 serves both. Each
   email carries an `event_email_id` tag, and the receiver routes the event
   to dues notices or event emails by it. No second webhook is needed.
6. **Bulk fixes.** To fix many sign-ups or events with SQL without
   emailing anyone, run
   `set local kit.suppress_event_emails = 'on';` inside the same
   transaction. Every enqueue trigger then does nothing.
7. **Reading `event_emails` and `event_email_runs`.** Each job run adds a row
   to `event_email_runs` with the mode, `candidates`, `sent`, `skipped`,
   `failed` and any `error`. A run with `mode = 'off'` or an `error` of
   "Live mode needs …" explains an empty outbox. Per-email state is in
   `event_emails.status`: `pending`, `sending`, `sent`, `failed` (retried
   up to three times, 15 minutes apart), `dead` (a permanent 4xx, check
   `error`), `dry_run`, `superseded`, `expired` (the shift started, or the
   row is over 72 hours old) and `no_email`. A row stuck in `sending` for 10
   minutes is reclaimed.
8. **Resend rate limit.** Resend allows about two requests a second. Emails
   with a calendar file are sent one at a time, about 0.6 seconds apart, and
   the immediate dispatch after an action stops after about 45 seconds and the
   daily job after about 4 minutes (240 seconds); anything left is picked up
   by the next run. A very large sign-up burst therefore drains over several runs.
9. **Deploy order.** Deploy the migration before or with the app.
