#!/bin/sh
set -eu

# Pre-flight config check, run before Next ever loads. src/instrumentation.ts's
# register() does the same check but Next 16's production server (`next
# start` / this image's standalone server.js) doesn't reliably crash on its
# throw — see that file's comment for the source-level why. This runs
# outside Next entirely, so there is no framework code path that can swallow
# it: a bad secret means server.js is never even exec'd.
#
# PLACEHOLDER_SECRET is duplicated here rather than imported — this script
# runs via plain `sh`, before Node/TypeScript, with none of src/'s module
# graph or npm dependencies. Source of truth is src/lib/auth-secret.ts's
# PLACEHOLDER_SECRET export; keep this in sync with it.
PLACEHOLDER_SECRET='change-me-32-chars-minimum-secret!!'

if [ -z "${BETTER_AUTH_SECRET:-}" ] || [ "$BETTER_AUTH_SECRET" = "$PLACEHOLDER_SECRET" ] || [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
  echo "BETTER_AUTH_SECRET missing or invalid (need >=32 chars) - refusing to start" >&2
  exit 1
fi

# BETTER_AUTH_URL gets the same treatment as the secret, and for the same
# reason: this app builds with output:"standalone" and no
# experimental.trustHostHeader, so src/lib/api-auth.ts's trusted-origin
# guard falls back to the server's own bind origin (HOSTNAME/PORT), never
# the browser's real Host — a fallback no real browser Origin can ever
# match. Missing BETTER_AUTH_URL doesn't crash the process or fail to bind
# the port, so unlike a missing secret it would otherwise pass GET
# /api/health (which only checks the secret) while every state-changing
# request 401s — a write outage the deploy pipeline's health-poll rollback
# would never catch. Refusing to exec here means the container never opens
# the healthcheck port at all, so it fails exactly the same way a bad
# secret does: compose healthcheck never turns healthy, and the deploy
# workflow's poll-then-rollback loop (.github/workflows/deploy.yml) catches
# it without needing a matching change to /api/health itself.
#
# This only checks the scheme prefix, not the full shape — e.g. a trailing
# slash (`https://host/`) passes here. That's deliberate, not a gap: every
# reader of this env var (src/lib/api-auth.ts's isTrustedRequestOrigin,
# better-auth's own baseURL, src/app/api/v1/invites/route.ts) normalizes
# through `new URL(x).origin`, which strips a trailing slash, so the value
# is safe by the time it matters. Rejecting it here would just be operator-
# hostile for a shape that's already harmless. What this guard cannot do,
# ever, is confirm the value is the *right* host — only that it looks like
# a URL.
case "${BETTER_AUTH_URL:-}" in
  http://*|https://*) ;;
  *)
    echo "BETTER_AUTH_URL missing or invalid (must start with http:// or https://) - refusing to start" >&2
    exit 1
    ;;
esac

exec node server.js
