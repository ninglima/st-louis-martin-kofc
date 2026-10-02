#!/usr/bin/env bash
# One-time Google Cloud setup for the portal. Idempotent: safe to re-run.
# Run it yourself (it changes shared cloud state):
#   PROJECT_ID=... GITHUB_REPOSITORY_ID=... ./infra/gcp/setup.sh
#
# GITHUB_REPOSITORY_ID is the repository's numeric ID. The Workload Identity
# provider pins it, not only the name, because a name can be reclaimed by
# someone else after a rename or transfer; the ID cannot. Get it with:
#   gh api repos/ninglima/st-louis-martin-kofc --jq .id
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${GITHUB_REPOSITORY_ID:?Set GITHUB_REPOSITORY_ID (gh api repos/ninglima/st-louis-martin-kofc --jq .id)}"
case "$GITHUB_REPOSITORY_ID" in
  '' | *[!0-9]*)
    echo "GITHUB_REPOSITORY_ID must be the numeric repository ID, got: $GITHUB_REPOSITORY_ID" >&2
    exit 1
    ;;
esac
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
# Only tokens from this repository (by ID and by name) on main are accepted.
# Re-running does NOT update an existing provider's mapping or condition; when
# the provider already exists the script prints the update-oidc command that
# applies the values below, for you to run:
#   gcloud iam workload-identity-pools providers update-oidc github-main \
#     --workload-identity-pool github --location global \
#     --attribute-mapping "<ATTRIBUTE_MAPPING>" --attribute-condition "<ATTRIBUTE_CONDITION>"
ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref"
ATTRIBUTE_CONDITION="assertion.repository_id=='$GITHUB_REPOSITORY_ID' && assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global >/dev/null 2>&1; then
  echo "Provider $PROVIDER already exists; its mapping and condition were NOT updated. To apply the current ones:"
  echo "  gcloud iam workload-identity-pools providers update-oidc $PROVIDER --workload-identity-pool $POOL --location global \\"
  echo "    --attribute-mapping \"$ATTRIBUTE_MAPPING\" \\"
  echo "    --attribute-condition \"$ATTRIBUTE_CONDITION\""
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "$ATTRIBUTE_MAPPING" \
    --attribute-condition "$ATTRIBUTE_CONDITION"
fi
POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL" --location global --format 'value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$REPO" >/dev/null

# Secrets: created empty here; add values with
#   printf '%s' "$VALUE" | gcloud secrets versions add NAME --data-file=-
# Every one needs a version before the first deploy, because the deploy
# workflow mounts each as NAME:latest. Env var -> secret:
#   SUPABASE_SERVICE_ROLE_KEY -> supabase-service-role-key
#   ORIGIN_AUTH               -> origin-auth (same value as the router's secret)
#   CAPTCHA_SECRET_TOKEN      -> captcha-secret-token
#   RESEND_API_KEY            -> resend-api-key
#   RESEND_WEBHOOK_SECRET     -> resend-webhook-secret
#   DUES_JOBS_SECRET          -> dues-jobs-secret (same value as the router's secret)
# Until email goes live (DUES_NOTICES_MODE / EVENT_EMAILS_MODE stay off), the
# two Resend secrets may hold a placeholder.
SECRETS="supabase-service-role-key origin-auth captcha-secret-token resend-api-key resend-webhook-secret dues-jobs-secret"
for SECRET in $SECRETS; do
  gcloud secrets describe "$SECRET" >/dev/null 2>&1 || gcloud secrets create "$SECRET" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

EMPTY=""
for SECRET in $SECRETS; do
  [ -n "$(gcloud secrets versions list "$SECRET" --filter state=ENABLED --limit 1 --format 'value(name)')" ] || EMPTY="$EMPTY $SECRET"
done
if [ -n "$EMPTY" ]; then
  echo "These secrets have no enabled version yet; the deploy fails until each has one:"
  for SECRET in $EMPTY; do echo "  printf '%s' \"<value>\" | gcloud secrets versions add $SECRET --data-file=-"; done
fi

echo "GitHub variables:"
echo "  GCP_PROJECT_ID=$PROJECT_ID"
echo "  GCP_WIF_PROVIDER=$POOL_ID/providers/$PROVIDER"
echo "  GCP_DEPLOY_SA=$DEPLOY_SA"
echo "  GCP_RUNTIME_SA=$RUNTIME_SA"
