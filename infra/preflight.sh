#!/usr/bin/env bash
# ok/info/missing always succeed, so `test && ok || missing` is safe here.
# shellcheck disable=SC2015
# Read-only check of everything the deploy needs outside this repo: Google
# Cloud, GitHub, Cloudflare, Supabase and DNS. Changes nothing; prints OK or
# MISSING per item, with the fix for each MISSING one. Safe to re-run.
#   PROJECT_ID=... ./infra/preflight.sh
# PROJECT_ID defaults to the active gcloud project. Never prints secret values.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

REPO=ninglima/st-louis-martin-kofc
REGION=us-east4
DOMAIN=kofc-15256.org
SUPABASE_REF=ktpircfnfdwhpowagppk
PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}
SECRETS="supabase-service-role-key origin-auth captcha-secret-token resend-api-key resend-webhook-secret dues-jobs-secret"
GH_VARS="GCP_PROJECT_ID GCP_WIF_PROVIDER GCP_DEPLOY_SA GCP_RUNTIME_SA NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY PORTAL_ORIGIN"
GH_OPTIONAL_VARS="NEXT_PUBLIC_CAPTCHA_SITE_KEY SITE_URL ROUTER_ENV DUES_NOTICES_MODE DUES_NOTICES_FROM DUES_NOTICES_REPLY_TO EVENT_EMAILS_MODE EVENT_EMAILS_FROM EVENT_EMAILS_REPLY_TO ENABLE_E2E_JOB"
GH_SECRETS="CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID"
WORKER_SECRETS="ORIGIN_AUTH DUES_JOBS_SECRET"

MISSING=0
ok() { printf '  OK       %s\n' "$1"; }
missing() {
  printf '  MISSING  %s\n' "$1"
  [ -n "${2:-}" ] && printf '           fix: %s\n' "$2"
  MISSING=$((MISSING + 1))
}
info() { printf '  INFO     %s\n' "$1"; }
section() { printf '\n%s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
contains() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac; }

section "Google Cloud (project: ${PROJECT_ID:-unset})"
if ! have gcloud; then
  missing "gcloud CLI" "install the Google Cloud SDK"
elif [ -z "$PROJECT_ID" ]; then
  missing "project" "PROJECT_ID=... ./infra/preflight.sh"
elif ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  missing "project $PROJECT_ID is reachable as $(gcloud config get-value account 2>/dev/null)" "gcloud auth login"
else
  BILLING=$(gcloud billing projects describe "$PROJECT_ID" --format 'value(billingAccountName)' 2>/dev/null)
  [ -n "$BILLING" ] && ok "billing account linked ($BILLING); confirm it is past the free trial" ||
    missing "billing account linked" "Console → Billing → link a paid billing account"

  ENABLED=$(gcloud services list --enabled --project "$PROJECT_ID" --format 'value(config.name)' 2>/dev/null | tr '\n' ' ')
  for API in run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com iam.googleapis.com; do
    contains "$ENABLED" "$API" && ok "API $API" || missing "API $API" "infra/gcp/setup.sh"
  done

  gcloud artifacts repositories describe portal --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 &&
    ok "Artifact Registry repo portal" || missing "Artifact Registry repo portal" "infra/gcp/setup.sh"

  for SA in portal-runtime portal-deploy; do
    gcloud iam service-accounts describe "$SA@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1 &&
      ok "service account $SA" || missing "service account $SA" "infra/gcp/setup.sh"
  done

  CONDITION=$(gcloud iam workload-identity-pools providers describe github-main --workload-identity-pool github \
    --location global --project "$PROJECT_ID" --format 'value(attributeCondition)' 2>/dev/null)
  if [ -z "$CONDITION" ]; then
    missing "Workload Identity provider github/github-main" "infra/gcp/setup.sh"
  elif [[ "$CONDITION" == *"repository_id"* && "$CONDITION" == *"refs/heads/main"* ]]; then
    ok "Workload Identity provider (pins repository ID and main)"
  else
    missing "Workload Identity provider condition pins repository ID and main" "re-run infra/gcp/setup.sh and run the update-oidc command it prints"
  fi

  for SECRET in $SECRETS; do
    if ! gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
      missing "secret $SECRET" "infra/gcp/setup.sh"
    elif [ -z "$(gcloud secrets versions list "$SECRET" --project "$PROJECT_ID" --filter state=ENABLED --limit 1 --format 'value(name)' 2>/dev/null)" ]; then
      missing "secret $SECRET has a value" "printf '%s' \"<value>\" | gcloud secrets versions add $SECRET --data-file=-"
    else
      ok "secret $SECRET has a value"
    fi
  done

  URL=$(gcloud run services describe portal --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)' 2>/dev/null)
  [ -n "$URL" ] && info "Cloud Run service portal is deployed: $URL" || info "Cloud Run service portal not deployed yet (the first merge to main creates it)"
fi

section "GitHub ($REPO)"
if ! have gh; then
  missing "gh CLI" "brew install gh && gh auth login"
elif ! gh auth status >/dev/null 2>&1; then
  missing "gh signed in" "gh auth login"
else
  VARS=$(gh variable list --repo "$REPO" --json name --jq '.[].name' 2>/dev/null | tr '\n' ' ')
  for NAME in $GH_VARS; do
    contains "$VARS" "$NAME" && ok "variable $NAME" ||
      missing "variable $NAME" "gh variable set $NAME --repo $REPO$([ "$NAME" = PORTAL_ORIGIN ] && echo '   (after the portal first deploys; runbook 2.4)')"
  done
  for NAME in $GH_OPTIONAL_VARS; do
    contains "$VARS" "$NAME" && ok "variable $NAME (optional)" || info "variable $NAME not set (optional; the default applies)"
  done
  SECRET_NAMES=$(gh secret list --repo "$REPO" --json name --jq '.[].name' 2>/dev/null | tr '\n' ' ')
  for NAME in $GH_SECRETS; do
    contains "$SECRET_NAMES" "$NAME" && ok "secret $NAME" || missing "secret $NAME" "gh secret set $NAME --repo $REPO"
  done
  if gh api "repos/$REPO/branches/main/protection" >/dev/null 2>&1; then
    ok "main is protected"
  else
    missing "main is protected (PR + the Workflow check required)" "GitHub → Settings → Branches → add a rule for main"
  fi
fi

section "Cloudflare"
WRANGLER=(pnpm --silent --filter router exec wrangler)
if ! "${WRANGLER[@]}" whoami >/dev/null 2>&1; then
  missing "wrangler signed in" "pnpm --filter router exec wrangler login"
else
  ok "wrangler signed in"
  for ENV_FLAG in "" "--env production"; do
    LABEL=${ENV_FLAG:+production}
    LABEL=${LABEL:-default (workers.dev)}
    # shellcheck disable=SC2086
    NAMES=$("${WRANGLER[@]}" secret list $ENV_FLAG --format json 2>/dev/null | jq -r '.[].name' 2>/dev/null | tr '\n' ' ')
    for NAME in $WORKER_SECRETS; do
      contains "$NAMES" "$NAME" && ok "Worker secret $NAME [$LABEL]" ||
        missing "Worker secret $NAME [$LABEL]" "pnpm --filter router exec wrangler secret put $NAME $ENV_FLAG"
    done
  done
fi

section "Supabase"
if ! have supabase && ! pnpm --silent --filter portal exec supabase --version >/dev/null 2>&1; then
  missing "supabase CLI" "pnpm install"
else
  if pnpm --silent --filter portal exec supabase projects list 2>/dev/null | grep -q "$SUPABASE_REF"; then
    ok "hosted project $SUPABASE_REF reachable"
  else
    missing "hosted project $SUPABASE_REF reachable" "pnpm --filter portal exec supabase login"
  fi
fi
info "Check by hand in the Supabase dashboard: Pro plan; GitHub integration working directory = apps/portal;"
info "Site URL = https://$DOMAIN; redirect URLs; email templates match apps/portal/supabase/templates."

section "DNS"
if have dig; then
  for HOST in "$DOMAIN" "www.$DOMAIN"; do
    info "$HOST → $(dig +short "$HOST" | tr '\n' ' ')"
  done
  NS=$(dig +short NS "$DOMAIN" | tr '\n' ' ')
  [[ "$NS" == *cloudflare.com* ]] && ok "$DOMAIN uses Cloudflare nameservers" ||
    missing "$DOMAIN uses Cloudflare nameservers (got: $NS)" "move the zone to Cloudflare"
fi

printf '\n%s item(s) missing.\n' "$MISSING"
[ "$MISSING" -eq 0 ]
