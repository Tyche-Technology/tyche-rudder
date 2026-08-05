# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
# Node >=20.9 is a hard floor (sharp@0.35.x, Next 16.2.12) — node:22-alpine clears it.

# ---- deps: npm ci once, reused by the build stage and (for two packages) the runtime stage ----
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: full source + deps, produces .next/standalone ----
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# scripts/seed-admin.ts needs the same treatment as migrate.mjs: it imports
# @/lib/better-auth (the real, load-bearing config — generateId:'serial',
# disableSignUp, the admin plugin, additionalFields) and must hash passwords
# through that exact instance, not a hand-copied one. tsx/esbuild are
# devDependencies absent from the runtime image, so bundle it here where
# they exist. drizzle-orm and postgres stay external (already copied into
# the runner below); everything else — better-auth and its own dependency
# tree, all pure JS, confirmed by a zero-warning bundle — is inlined, so no
# extra node_modules copying is needed for it.
RUN node_modules/.bin/esbuild scripts/seed-admin.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --external:drizzle-orm --external:'drizzle-orm/*' --external:postgres \
  --outfile=scripts/seed-admin.mjs

# revoke-token is an incident tool, so it has to exist where the incident is.
# Same bundling reason as above (tsx is a devDependency); it only pulls in
# @/db/client and @/db/schema, both of which need drizzle-orm/postgres external.
RUN node_modules/.bin/esbuild scripts/revoke-token.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --external:drizzle-orm --external:'drizzle-orm/*' --external:postgres \
  --outfile=scripts/revoke-token.mjs

# ---- runner: minimal runtime image ----
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# scripts/migrate.mjs needs drizzle-orm + postgres at runtime, but Next's
# output-file-tracing only follows imports reachable from the Next app itself
# — it never sees migrate.mjs, so it drops both packages from
# .next/standalone/node_modules (confirmed empty by inspection during this
# task). Copied explicitly; both ship with zero runtime dependencies of their
# own (checked package.json), so nothing else is needed.
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres

# Runtime cache and the optional filesystem object store must be writable by
# the non-root user. Mount persistent storage at /app/.rudder-objects when
# OBJECT_STORE_BACKEND=fs.
RUN mkdir .next .rudder-objects && chown node:node .next .rudder-objects

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

# license notices must travel with the distributed artifact — Next's bundling
# strips per-package LICENSE files, THIRD-PARTY-NOTICES.md is the aggregate
COPY --from=builder --chown=node:node /app/LICENSE /app/THIRD-PARTY-NOTICES.md ./
COPY --from=builder --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=node:node /app/scripts/seed-admin.mjs ./scripts/seed-admin.mjs
COPY --from=builder --chown=node:node /app/scripts/revoke-token.mjs ./scripts/revoke-token.mjs
COPY --from=builder --chown=node:node /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh
RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

USER node
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
