import { isAuthSecretValid } from '@/lib/auth-secret'

const BOOT_ERROR = 'BETTER_AUTH_SECRET missing or invalid (need ≥32 chars) — refusing to start'

// Best-effort backstop, NOT the production guarantee — see register()'s
// comment below for why register() alone can't be trusted in production.
// Node's own default (an unhandled rejection crashes the process, since
// Node 15) never fires here because Next's server installs its own handler
// first. This re-asserts that default, narrowly scoped to this exact boot
// error so it can't turn some unrelated unhandled rejection elsewhere in
// the app into a surprise process exit. It does help in `next dev` and in
// whatever fraction of `next start` requests happen to race register()
// correctly — it just can't be relied on for either.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && reason.message.includes(BOOT_ERROR)) process.exit(1)
})

// Next.js calls register() once at server boot. It reliably crashes
// `next dev` — genuinely useful there, a bad secret fails loudly before you
// ever hit a route.
//
// It does NOT reliably protect production. Traced in
// node_modules/next/dist/server/next.js: NextServer.prepare() only awaits
// real server preparation `if (this.options.dev)`. Under `next start` / the
// standalone server.js the Dockerfile runs, register() executes
// fire-and-forget — some requests can be served before it has even run, and
// when it does reject, next-server.js swallows the rejection into a
// background 500 instead of crashing. Confirmed against the actual
// generated server.js (not just `next start`), and confirmed a second time
// against this exact route set (GET /api/v1/products returns a normal 401
// with a bad secret, no crash).
//
// The real production guarantees live elsewhere, specifically because
// nothing here can be trusted to run before Next starts serving:
// - scripts/docker-entrypoint.sh refuses to exec node server.js at all with
//   a bad secret. It runs before Next is even loaded, so there is no
//   framework code path that can swallow it.
// - src/app/api/health/route.ts reflects config validity so an orchestrator
//   can fail readiness or roll back without depending on process exit.
export async function register() {
  if (!isAuthSecretValid(process.env.BETTER_AUTH_SECRET)) throw new Error(BOOT_ERROR)
}
