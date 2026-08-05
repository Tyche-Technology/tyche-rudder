import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import path from 'node:path'

// This is the Postgres-backed integration test for the better-auth cutover
// (spec §7): the rest of the suite runs on PGlite via a single connection
// that serializes everything and can't reproduce a real driver's
// error/concurrency shape, and unit-level route tests authenticate through
// tests/helpers/auth.ts's createSessionUser (already exercises getAuth()
// against real Postgres via PGlite substitution, but never through an actual
// HTTP round trip). Only a real `next dev` server hit over HTTP proves the
// cookie better-auth sets is one a real browser could use end to end —
// Set-Cookie attributes, redirect handling, and better-auth's own
// origin-check middleware all only exist on that path.
//
// Requires Docker. No new dependency: reuses drizzle-orm/postgres-js
// (already a prod dependency) and the docker/next CLIs already used
// elsewhere in this project.

const execFileAsync = promisify(execFile)

// Derived per run, not hardcoded: two live-test runs (this worktree and a
// sibling one, or two local re-runs racing each other) must never fight over
// the same port or container name. The predecessor of this file hardcoded
// PG_PORT=5434 / APP_PORT=3101 / CONTAINER_NAME='rudder-session-live-test-pg'
// and that already produced two false-red runs in this project when another
// agent's own Docker verification happened to run at the same time.
const RUN_ID = `${process.pid}-${randomInt(1000, 9999)}`
const PORT_BASE = 20000 + randomInt(0, 4000) * 2 // +1 below always lands on a distinct port
const PG_PORT = PORT_BASE
const APP_PORT = PORT_BASE + 1
const DATABASE_URL = `postgres://rudder:rudder@localhost:${PG_PORT}/rudder`
const BASE_URL = `http://localhost:${APP_PORT}`
const BETTER_AUTH_SECRET = 'live-auth-test-secret-1234567890abcdef!!'
const CONTAINER_NAME = `rudder-auth-live-test-pg-${RUN_ID}`
const ADMIN_EMAIL = 'captain@live-test.local'
const ADMIN_PASSWORD = 'auth-live-admin-pw-1'
const ADMIN_NAME = '실서버 검증 관리자'
const INVITEE_EMAIL = 'invitee@live-test.local'
const INVITEE_PASSWORD = 'live-invitee-pw-9'

let nextProcess: ChildProcess | undefined
const TSCONFIG_PATH = path.join(process.cwd(), 'tsconfig.json')
let originalTsconfig: string | undefined

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await check().catch(() => false)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for readiness`)
}

// Next 16 (Turbopack) holds a per-project-directory dev lock and a second
// `next dev` in the same directory refuses to start while a prior one's lock
// is still present (README "dev 서버는 한 번에 하나만"). `kill()` alone doesn't
// wait for the child to actually exit — and lock cleanup happens as part of
// that exit — so a caller that kills and immediately returns can race a
// closely-following `next dev` invocation in the SAME directory. That never
// showed up locally (worktrees are separate directories), but CI runs this
// whole suite twice back to back in the one checkout: `ci.yml`'s `test` job
// runs the full suite, then `coverage-gate.sh`'s `npm test -- --coverage`
// runs it again — and the second pass's `next dev` collided with the first
// pass's not-yet-released lock, killing this test with a `next dev` error
// that `stdio: 'ignore'` had also been hiding.
function killAndWait(proc: ChildProcess | undefined, timeoutMs = 5000): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve() }, timeoutMs)
    proc.once('exit', () => { clearTimeout(timer); resolve() })
    proc.kill('SIGTERM')
  })
}

// Idempotent by construction (docker rm -f on a name that doesn't exist just
// errors, swallowed here) — safe to call from the beforeAll failure path AND
// unconditionally from afterAll, so the container is cleaned up even when
// setup dies partway through.
async function removeContainer(): Promise<void> {
  await execFileAsync('docker', ['rm', '-f', CONTAINER_NAME]).catch(() => {})
}

// Every request mirrors what a real browser sends: an Origin header on every
// fetch. better-auth's own origin-check middleware requires one on any
// cookie-bearing, state-changing request (e.g. sign-out) — Node's fetch()
// does not attach Origin the way a browser does, so omitting it here would
// 403 against better-auth's own endpoints before this test ever gets to
// exercise anything.
function fetchLive(urlPath: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${urlPath}`, { ...init, headers: { origin: BASE_URL, ...init.headers } })
}

beforeAll(async () => {
  // next dev rewrites tsconfig.json's `include` on boot; snapshot it so
  // afterAll can restore it and this test doesn't dirty the working tree.
  originalTsconfig = await readFile(TSCONFIG_PATH, 'utf-8')

  try {
    await execFileAsync('docker', ['rm', '-f', CONTAINER_NAME]).catch(() => {})
    try {
      await execFileAsync('docker', [
        'run', '-d', '--name', CONTAINER_NAME,
        '-p', `127.0.0.1:${PG_PORT}:5432`,
        '-e', 'POSTGRES_USER=rudder', '-e', 'POSTGRES_PASSWORD=rudder', '-e', 'POSTGRES_DB=rudder',
        'postgres:15-alpine',
      ])
    } catch (e) {
      throw new Error(
        'tests/api/auth-live.test.ts needs Docker to run a real Postgres + real Next server ' +
        "(the only way to genuinely exercise better-auth's session end to end). Start Docker and retry. " +
        `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    await waitFor(async () => {
      const { stdout } = await execFileAsync('docker', ['exec', CONTAINER_NAME, 'pg_isready', '-U', 'rudder'])
      return stdout.includes('accepting connections')
    }, 20_000)

    await execFileAsync('npx', ['drizzle-kit', 'migrate'], { env: { ...process.env, DATABASE_URL } })
    await execFileAsync('npx', ['tsx', 'scripts/seed-admin.ts'], {
      env: {
        ...process.env, DATABASE_URL, BETTER_AUTH_SECRET,
        SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: ADMIN_PASSWORD, SEED_ADMIN_NAME: ADMIN_NAME,
      },
    })

    // Doubling the wait (60s -> 120s) did not change the outcome at all on
    // CI — same timeout, same failure point, no partial progress. A pure
    // CPU-contention delay would show SOME improvement from 2x the budget;
    // getting the identical failure twice means `next dev` most likely never
    // becomes reachable at all in that environment, not merely "too slow" —
    // but `stdio: 'ignore'` threw away the one thing that would prove it.
    // Capture instead, and print it (and the last connection error, which
    // `waitFor`'s `.catch(() => false)` was also silently discarding) on
    // failure so the next CI run reports a cause instead of a guess.
    let nextOutput = ''
    let lastFetchError: unknown
    nextProcess = spawn('npx', ['next', 'dev', '-p', String(APP_PORT)], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL: BASE_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    nextProcess.stdout?.on('data', (d) => { nextOutput += d.toString() })
    nextProcess.stderr?.on('data', (d) => { nextOutput += d.toString() })
    nextProcess.on('exit', (code, signal) => {
      nextOutput += `\n[next dev exited: code=${code} signal=${signal}]\n`
    })
    try {
      await waitFor(async () => {
        try {
          return (await fetch(`${BASE_URL}/api/health`)).ok
        } catch (e) {
          lastFetchError = e
          return false
        }
      }, 120_000)
    } catch (waitError) {
      console.error('--- next dev output ---\n' + nextOutput)
      console.error('--- last fetch error ---\n', lastFetchError)
      throw waitError
    }
  } catch (error) {
    await killAndWait(nextProcess)
    await removeContainer()
    throw error
  }
}, 150_000) // default hookTimeout (30s, vitest.config.ts) is tuned for PGlite hooks, not
// this one — must exceed the health-check wait above (120s) plus the
// container start/migrate/seed-admin steps before it

afterAll(async () => {
  await killAndWait(nextProcess)
  await removeContainer()
  if (originalTsconfig !== undefined) await writeFile(TSCONFIG_PATH, originalTsconfig)
})

describe('invite + login round trip against a real Next.js server backed by better-auth (no mocks)', () => {
  // Default 5s test timeout is too tight here: next dev compiles each route
  // lazily on its first request, and this test is the first hit for half a
  // dozen distinct routes against a server that just booted.
  it('admin signs in, invites a user, the invitee accepts and gets a working session, and sign-out ends it', { timeout: 60_000 }, async () => {
    const signInRes = await fetchLive('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    })
    expect(signInRes.status).toBe(200)
    const adminSetCookie = signInRes.headers.get('set-cookie')
    expect(adminSetCookie).toMatch(/better-auth\.session_token=/)
    const adminCookie = adminSetCookie!.split(';')[0]

    const usersRes = await fetchLive('/api/v1/users', { headers: { cookie: adminCookie } })
    expect(usersRes.status).toBe(200)
    const usersBody = await usersRes.json()
    expect(usersBody.ok).toBe(true)
    const adminRow = usersBody.data.find((u: { email: string }) => u.email === ADMIN_EMAIL)
    expect(adminRow).toMatchObject({ email: ADMIN_EMAIL, role: 'admin', banned: false })

    const inviteRes = await fetchLive('/api/v1/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ email: INVITEE_EMAIL, name: '실서버 초대 유저' }),
    })
    expect(inviteRes.status).toBe(201)
    const inviteBody = await inviteRes.json()
    const token = (inviteBody.data.inviteUrl as string).split('/').pop()!
    expect(token).toMatch(/^[0-9a-f]{64}$/)

    const acceptRes = await fetchLive('/api/v1/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: INVITEE_PASSWORD }),
    })
    expect(acceptRes.status).toBe(200)
    const inviteeSetCookie = acceptRes.headers.get('set-cookie')
    expect(inviteeSetCookie).toMatch(/better-auth\.session_token=/)
    const inviteeCookie = inviteeSetCookie!.split(';')[0]

    // The invited user's brand-new session actually works, not just that
    // accept() returned 200.
    const inviteeUsersRes = await fetchLive('/api/v1/users', { headers: { cookie: inviteeCookie } })
    expect(inviteeUsersRes.status).toBe(200)

    const signOutRes = await fetchLive('/api/auth/sign-out', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: inviteeCookie }, body: '{}',
    })
    expect(signOutRes.status).toBe(200)
    const afterSignOutRes = await fetchLive('/api/v1/users', { headers: { cookie: inviteeCookie } })
    expect(afterSignOutRes.status).toBe(401)
  })
})
