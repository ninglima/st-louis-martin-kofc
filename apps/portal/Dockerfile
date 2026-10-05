# Build from the repo root: docker build -f apps/portal/Dockerfile .
FROM node:24-slim AS base
RUN npm install -g pnpm@11.18.0 turbo@2.10.8

FROM base AS prune
WORKDIR /repo
COPY . .
# `turbo prune portal --docker` alone drops tooling/scripts (the `scripts`
# workspace package; not a dependency of portal) from both the pruned
# workspace and the pruned lockfile, which breaks the root preinstall
# (`pnpm run --filter scripts requirements`). Naming it explicitly here
# keeps it -- and its lockfile importer entry -- in the pruned output, so
# the install below can stay `--frozen-lockfile`.
RUN turbo prune portal scripts --docker

FROM base AS build
WORKDIR /repo
COPY --from=prune /repo/out/json/ .
# `out/json` only carries package.json files (for install-layer caching), but
# the root preinstall (`pnpm run --filter scripts requirements`) executes
# tooling/scripts/src/requirements.mjs, which only exists in `out/full`.
# Pulling in just that one package's full source ahead of `pnpm install`
# keeps the caching benefit for every other package while letting preinstall
# actually run.
COPY --from=prune /repo/out/full/tooling/scripts ./tooling/scripts
RUN CI=true pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CAPTCHA_SITE_KEY=""
ARG NEXT_PUBLIC_CI=""
# `/version` is prerendered under Cache Components (`use cache` +
# `cacheLife('max')`), so GIT_HASH has to be baked in at build time; a
# runtime `docker run -e GIT_HASH=...` has no effect on the prerendered route.
ARG GIT_HASH=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CAPTCHA_SITE_KEY=$NEXT_PUBLIC_CAPTCHA_SITE_KEY \
    NEXT_PUBLIC_CI=$NEXT_PUBLIC_CI \
    GIT_HASH=$GIT_HASH \
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
