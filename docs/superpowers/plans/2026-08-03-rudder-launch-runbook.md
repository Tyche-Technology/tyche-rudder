# Rudder — Launch Runbook

Date: 2026-08-03, rewritten 2026-08-04 for the better-auth redesign
Status: **DRAFT — awaiting PO approval. Nothing below has been executed.**

Every step names what it changes and how to undo it. Steps 1–4 create infrastructure,
step 5 is the first deploy, steps 6–8 make it usable and prove it works.

GCP project is `<gcp-project-id>` — the only Tyche project. Run
`gcloud config get project` before anything else.

## This runbook targets the post-redesign state

The IT Portal auth is being replaced by better-auth on `feat/auth-redesign-2`
(`docs/superpowers/plans/2026-08-04-auth-redesign.md`). That plan's own rule is
**do not merge before its Task 11** — mid-branch the login UI is deliberately broken,
since the old login is deleted before the new one lands.

So this runbook describes the state *after* that branch merges. Anything below marked
**[after T10/T11]** does not exist on `master` yet. Do not start step 5 until the
redesign is merged and green.

The previous version of this file described a CSV seed, `SESSION_SECRET`, and an IT
Portal toggle. All three are gone; if you are reading a printout, discard it.

## Prerequisites

| # | Item | Owner | Blocks |
|---|------|-------|--------|
| P1 | Auth redesign merged through its Task 11 (e2e repaired, deploy config updated) | dev | **Step 5** |
| P2 | Google Cloud OAuth client, if Google login is wanted at launch | PO | Step 3b only — email+password works without it |
| P3 | `<slack-bot-repo>` updated for the `requesterPortalId` → `requesterEmail` contract break | bot repo | Step 8 only |
| P4 | `_pick_product`'s substring heuristic in the bot has untested failure modes and now labels its guess high-confidence | bot repo | Step 8 only |

Steps 1–4 can proceed before P2.

---

## 1. VM

```bash
gcloud compute instances create tyche-rudder \
  --project=<gcp-project-id> --zone=asia-northeast3-a \
  --machine-type=e2-small --boot-disk-size=20GB \
  --image-family=debian-12 --image-project=debian-cloud
```

Then on the VM: install Docker + the compose plugin, **`wget`** (the compose healthcheck
shells out to it — a missing `wget` exits 127 and every deploy is judged unhealthy), and
Tailscale; `tailscale up` with node name `tyche-rudder`; confirm it appears in
`tailscale status`.

**Rollback:** `gcloud compute instances delete tyche-rudder --zone=asia-northeast3-a` —
destroys only this VM, nothing else references it yet.

**Why a new VM:** `<internal-dashboard>` is in europe-west1 while Cloud SQL `<cloud-sql-instance>` is in
asia-northeast3; hosting there crosses continents on every query (~230ms round trip, and
a reorder is 5+ sequential trips). ~$13/mo is the price of not doing that.

## 2. Database

```bash
gcloud sql users create rudder --instance=<cloud-sql-instance> --password='<generated>'
gcloud sql databases create rudder --instance=<cloud-sql-instance>
```

**Affects:** `<cloud-sql-instance>` gains one database and one user. The existing `tyche_db` database
is untouched — verify with `gcloud sql databases list --instance=<cloud-sql-instance>` before and
after; the before-list is `postgres`, `tyche_db`.

**Verify before step 5:** on Postgres 15 the `public` schema no longer grants CREATE to
PUBLIC by default. This normally still works on Cloud SQL — API-created users belong to
`cloudsqlsuperuser`, which owns API-created databases — but it is the classic first-deploy
migration failure, so confirm rather than assume:

```bash
psql "postgres://rudder:<password>@<proxy>/rudder" -c "CREATE TABLE _probe(); DROP TABLE _probe;"
```

If it fails, `GRANT CREATE ON SCHEMA public TO rudder;` as the instance's default user.

**Rollback:** `gcloud sql databases delete rudder --instance=<cloud-sql-instance>`, then
`gcloud sql users delete rudder --instance=<cloud-sql-instance>`. Zero rows of any other database are
touched.

## 3. Bucket and service account

```bash
gcloud storage buckets create gs://<gcs-bucket-name> \
  --location=asia-northeast3 --uniform-bucket-level-access
gcloud iam service-accounts create <runtime-service-account> --display-name="Rudder VM"
gcloud projects add-iam-policy-binding <gcp-project-id> \
  --member="serviceAccount:<service-account-email>" \
  --role="roles/cloudsql.client"
gcloud storage buckets add-iam-policy-binding gs://<gcs-bucket-name> \
  --member="serviceAccount:<service-account-email>" \
  --role="roles/storage.objectAdmin"
```

Create a key and place it on the VM at `~/rudder/credentials/sa.json`, mode 600.

**Note the scope deliberately:** `cloudsql.client` is project-level (Cloud SQL IAM has no
per-instance binding for that role), but `storage.objectAdmin` is bound to **this bucket
only** — this SA cannot read `<log-archive-bucket>`, `sku-photo-bucket`, or anything else.

**Rollback:** delete the key, then the SA, then the bucket.

## 3b. Google OAuth client — optional, only if Google login is wanted

Google is configured **conditionally**: `src/lib/better-auth.ts` enables the provider only
when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are present. Email+password login
works fully without this step; skip it and add it later if you prefer.

In the Google Cloud console, create an OAuth 2.0 Web client and set the authorized redirect
URI to exactly:

```
https://tyche-rudder.<tailnet>.ts.net/api/auth/callback/google
```

**A Google account that was never invited cannot create a user.**
`disableImplicitSignUp: true` means Google sign-in only ever links to or opens a session
for a user that already exists, and users only exist via an invite or the seed-admin
bootstrap. Linking is by verified email match — that is the entire Google-path gate.

**Rollback:** delete the OAuth client, or simply unset the two env vars and redeploy —
the provider disappears and email+password remains.

## 4. Secrets and environment

On the VM, `~/rudder/.env` (compose reads it automatically):

```
DB_PASSWORD=<from step 2>
BETTER_AUTH_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
BETTER_AUTH_URL=https://tyche-rudder.<tailnet>.ts.net
SLACK_BOT_TOKEN=<the existing bot token>
APP_BASE_URL=https://tyche-rudder.<tailnet>.ts.net
GCS_BUCKET=<gcs-bucket-name>
GOOGLE_CLIENT_ID=<from step 3b, omit if skipping>
GOOGLE_CLIENT_SECRET=<from step 3b, omit if skipping>
```

`BETTER_AUTH_SECRET` must be **≥32 characters and must not be the placeholder** that
`.env.example` ships. Three independent layers enforce that, and all three refuse rather
than degrade: `scripts/docker-entrypoint.sh` checks it in `sh` before Next loads and
refuses to exec; `src/instrumentation.ts` checks it at boot; and `/api/health` returns
**503** when it is invalid — which is the layer the deploy rollback actually polls.

`SLACK_CHANNEL_ID` is hardcoded to `<slack-channel-id>` in the compose file and needs no entry.

GitHub repo secrets the deploy workflow expects: `VM_HOST` (the tailnet name),
`VM_USERNAME`, `VM_SSH_KEY_BASE64`, plus `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`. The
last two may already exist org-wide from the dashboard's pipeline — **check before minting
new ones**; a second credential for the same purpose is a rotation hazard.

**Rollback:** delete `~/rudder/.env` and the repo secrets. Nothing is deployed yet.

## 5. First deploy — BLOCKED on P1

Push to `master`, or `workflow_dispatch`. The pipeline: test job (tsc → vitest →
coverage:gate) → build and push to GHCR by digest → join the tailnet → SSH → pull by digest
→ `docker compose run --rm rudder node scripts/migrate.mjs` (5 retries, 3s apart, for the
proxy's TCP readiness) → `docker compose up -d` → poll `/api/health` up to 120s → on
failure, roll back to the `:rollback`-tagged image.

Migrations 0000–0008 apply on the first run — 0007 adds better-auth's `session`, `account`,
`verification` and the app's `invites` table; 0008 is the legacy-auth teardown.

**On a first deploy there is no rollback image** — the script says so explicitly rather
than failing confusingly.

**Rollback:** re-run the workflow at an earlier commit, or on the VM
`docker tag ghcr.io/tyche-technology/tyche-rudder:rollback …:latest && docker compose up -d`.

## 6. Serve and bootstrap the first admin

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

Browse `https://tyche-rudder.<tailnet>.ts.net` from any tailnet device. ts.net terminates
TLS, which is what makes the session cookie's `Secure` flag work — there is no other ingress.

**There is no CSV seed any more.** The first admin comes from `scripts/seed-admin.ts`,
which reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (≥8 chars) and `SEED_ADMIN_NAME`,
and **refuses if any user already exists** — so it is safe to re-run and cannot create a
second bootstrap admin. Everyone after this comes in by invite.

Same constraint `scripts/migrate.mjs` solves for migrations — `tsx` (and `seed-admin.ts`'s
own devDependency-only import graph) is absent from the runtime image — so
`scripts/seed-admin.ts` is bundled at build time in the Dockerfile's builder stage
(esbuild, `drizzle-orm`/`postgres` marked external since the runner already has them,
everything else — including `better-auth` itself, so the real `src/lib/better-auth.ts`
config does the password hashing, not a reimplementation — inlined) and shipped as
`scripts/seed-admin.mjs` next to `migrate.mjs`. Run it the same way:

```bash
docker compose run --rm \
  -e SEED_ADMIN_EMAIL='admin@example.com' \
  -e SEED_ADMIN_PASSWORD='<random, ≥8 chars>' \
  -e SEED_ADMIN_NAME='<your name>' \
  rudder node scripts/seed-admin.mjs
```

Then mint the bot's API token with `npm run create-token hermes` and **store it in Secret
Manager** — never in the bot repo. Run that one from a local checkout pointed at the prod
DB through cloud-sql-proxy, not on the VM: `tsx` is a devDependency so it is absent from
the image, and the command prints the secret, which you do not want in a container log.

**To revoke a leaked token**, `revoke-token` IS bundled into the image (it is an incident
tool, so it has to exist where the incident is):

```bash
docker compose run --rm rudder node scripts/revoke-token.mjs hermes
```

It sets `api_tokens.revoked_at`; `actorFromRequest` refuses a set one on the next request,
with no redeploy. Deleting the row instead will fail — `comments`/`issue_events`/
`attachments` reference it `ON DELETE restrict` once that agent has written anything.

**Rollback:** `tailscale serve --https=443 off` removes access without touching data. To
undo the bootstrap admin you must delete the row by hand; there is no delete endpoint.

## 7. Onboard the team, and smoke-test

Log in as the bootstrap admin with email + password. Open **선원 (Crew)** in the admin nav
(`/crew`), click **초대** for each teammate, and **copy the one-time link** to them over
Slack — the dialog shows it exactly once.

How invites behave, so nothing here surprises you:

- The user row is created **at invite time**, with a random password nobody knows. The
  invitee sets a real one through the accept link.
- Links expire after **7 days**.
- Re-issuing an invite for an email that already exists **replaces that user's unused
  invites and never duplicates the user** — so the same flow doubles as a password reset.
- The token is 256-bit and is the accept route's only defence; treat the link as a
  credential.

**Smoke test after at least one teammate is in:** create a real issue, groom it, upload an
attachment, confirm the channel message in `<slack-channel-id>`, transition it, confirm the
requester DM. Slack DMs need `users.slack_user_id` populated — it is no longer set by a
seed CSV, so confirm how it gets filled for real users before expecting DMs.

**Delete nothing afterward.** There are no delete endpoints by design, and several
existence pre-checks are race-free only because of that. The test issue stays as issue #1.

## 8. Enable the Slack bot intake — BLOCKED on P3

**The agent contract changed.** Issue creation by an agent now takes `requesterEmail`
(the email of an existing user) where it previously took `requesterPortalId`. The bot's
`rudder_create_issue` tool and its Slack-user→Rudder-user mapping must be updated before
this is turned on, or every bot-filed issue fails validation.

Once the bot is updated, set `RUDDER_API_BASE` to the ts.net URL and the token from step 6
in the bot's config, then release per the bot repo's own process.

---

## What this launch does NOT include

- **No public ingress.** The service is reachable only over the tailnet; `tailscale serve`
  is the only path in. Login rate limiting is therefore not a launch item — the threat it
  defends against cannot reach the service. better-auth's own limiter covers its endpoints
  in production regardless.
- **No public sign-up, by construction.** `disableSignUp` on email+password and
  `disableImplicitSignUp` on Google mean a user can only come from an invite or the
  bootstrap script.
- **No attachment deletion, and no deletion anywhere.** Several existence pre-checks are
  race-free only because nothing deletes products, users, milestones, or issues.
- **No notification outbox.** A Slack outage drops those notifications rather than queueing
  them.
- **Session revocation is still missing; agent-token revocation is not.** better-auth's
  admin plugin can ban a user, which the per-request DB-fresh role/banned read honours,
  and a leaked `rud_*` agent token is killed with `npm run revoke-token <name>` —
  `api_tokens.revoked_at` (migration 0010) and `actorFromRequest` refuses a set one.
  What remains unrevocable is a human's stateless sealed session cookie.
  Note the row cannot simply be deleted once that agent has written anything:
  `comments`/`issue_events`/`attachments` reference `api_tokens` `ON DELETE restrict`,
  which is why revocation is a flag.
