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
# Every one needs a version before the first deploy, because the deploy
# workflow mounts each as NAME:latest. Env var -> secret:
#   SUPABASE_SERVICE_ROLE_KEY -> supabase-service-role-key
#   ORIGIN_AUTH               -> origin-auth (same value as the router's secret)
#   CAPTCHA_SECRET_TOKEN      -> captcha-secret-token
for SECRET in supabase-service-role-key origin-auth captcha-secret-token; do
  gcloud secrets describe "$SECRET" >/dev/null 2>&1 || gcloud secrets create "$SECRET" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "GitHub variables:"
echo "  GCP_PROJECT_ID=$PROJECT_ID"
echo "  GCP_WIF_PROVIDER=$POOL_ID/providers/$PROVIDER"
echo "  GCP_DEPLOY_SA=$DEPLOY_SA"
echo "  GCP_RUNTIME_SA=$RUNTIME_SA"
