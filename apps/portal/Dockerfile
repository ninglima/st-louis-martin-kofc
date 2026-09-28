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
# `turbo prune` only keeps packages portal depends on, so tooling/scripts
# (used by the root preinstall/postinstall scripts, not by portal itself)
# is missing from the pruned workspace and from the pruned lockfile. Copy it
# in so `pnpm install`'s `preinstall` (`pnpm run --filter scripts
# requirements`) can find it. Its only dependency (@types/node) is already
# resolved in the pruned lockfile via portal's own devDependencies, so
# `--no-frozen-lockfile` here just lets pnpm add the missing importer entry
# without touching any resolved versions or hitting the network.
COPY tooling/scripts ./tooling/scripts
RUN CI=true pnpm install --no-frozen-lockfile
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
