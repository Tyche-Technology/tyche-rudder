import { spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { request } from '@playwright/test'
import postgres from 'postgres'
import { z } from 'zod'
import {
  E2E_BASE_URL,
  E2E_ENV,
  E2E_ROOT,
  E2E_USER_SLACK_ID,
  E2E_USERS,
  type SlackCapture,
} from './helpers'

const DATABASE_PORT = 5435
const SLACK_PORT = 3299
const PROJECT_ROOT = process.cwd()
const slackPostSchema = z.object({ channel: z.string(), text: z.string() })
const inviteResponseSchema = z.object({ ok: z.literal(true), data: z.object({ inviteUrl: z.url() }) })

class SetupCommandError extends Error {
  constructor(command: string, status: number | null) {
    super(`E2E setup command failed (${status ?? 'no status'}): ${command}`)
    this.name = 'SetupCommandError'
  }
}

function run(command: string, args: readonly string[], extraEnv: Partial<NodeJS.ProcessEnv> = {}): void {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...E2E_ENV, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new SetupCommandError([command, ...args].join(' '), result.status)
}

// Playwright's webServer plugin starts (and health-polls) before globalSetup
// runs, so the real app is already serving by the time this fires — seeding
// the second fixture user through the actual invite+accept API is possible,
// and is the root-cause-correct choice over a DB backdoor: it's the exact
// flow the new invite-flow spec exercises through the browser, just driven
// here over HTTP for the fixture the OTHER specs need already in place.
// `origin` is set explicitly because this is a bare request context (no
// browser), which never sends one on its own — actorFromRequest's
// trusted-origin guard fail-closes any cookie-bearing POST without a
// matching Origin header.
async function seedFixtureUsers(): Promise<void> {
  run('npm', ['run', 'seed:admin'], {
    SEED_ADMIN_EMAIL: E2E_USERS.admin.email,
    SEED_ADMIN_PASSWORD: E2E_USERS.admin.password,
    SEED_ADMIN_NAME: E2E_USERS.admin.name,
  })

  const api = await request.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { origin: E2E_BASE_URL } })
  try {
    const signIn = await api.post('/api/auth/sign-in/email', {
      data: { email: E2E_USERS.admin.email, password: E2E_USERS.admin.password },
    })
    if (!signIn.ok()) throw new Error(`E2E admin sign-in failed: ${signIn.status()} ${await signIn.text()}`)

    const invite = await api.post('/api/v1/invites', {
      data: { email: E2E_USERS.user.email, name: E2E_USERS.user.name, role: 'user' },
    })
    if (!invite.ok()) throw new Error(`E2E user invite failed: ${invite.status()} ${await invite.text()}`)
    const { data: { inviteUrl } } = inviteResponseSchema.parse(await invite.json())
    const token = inviteUrl.split('/').at(-1)
    if (!token) throw new Error(`invite url has no token segment: ${inviteUrl}`)

    const accept = await api.post('/api/v1/invites/accept', {
      data: { token, password: E2E_USERS.user.password },
    })
    if (!accept.ok()) throw new Error(`E2E user invite-accept failed: ${accept.status()} ${await accept.text()}`)
  } finally {
    await api.dispose()
  }
}

async function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => { socket.destroy(); resolve(false) })
  })
}

async function waitForPostgres(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    // -h 127.0.0.1 forces TCP. The postgres image runs a temporary
    // socket-only server (listen_addresses='') while initdb runs, and a
    // socket-based pg_isready reports THAT as ready — then it shuts down and
    // migrate hits "the database system is starting up". Over TCP the temp
    // server is invisible, so this only ever waits longer, never shorter.
    const result = spawnSync('docker', ['exec', containerName, 'pg_isready', '-h', '127.0.0.1', '-U', 'rudder', '-d', 'rudder'], {
      stdio: 'ignore',
    })
    if (result.error) throw result.error
    if (result.status === 0) return
    await delay(250)
  }
  throw new Error('E2E Postgres did not become ready')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function startSlackServer(captures: SlackCapture[]): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/__captures') {
      sendJson(response, 200, captures)
      return
    }
    if (request.method === 'DELETE' && request.url === '/__captures') {
      captures.length = 0
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method !== 'POST' || request.url !== '/chat.postMessage') {
      sendJson(response, 404, { ok: false, error: 'not_found' })
      return
    }

    request.setEncoding('utf8')
    let raw = ''
    for await (const chunk of request) raw += chunk
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      sendJson(response, 400, { ok: false, error: 'invalid_json' })
      return
    }
    const parsed = slackPostSchema.safeParse(body)
    if (!parsed.success) {
      sendJson(response, 422, { ok: false, error: 'invalid_payload' })
      return
    }
    captures.push(parsed.data)
    sendJson(response, 200, { ok: true, ts: `${captures.length}.000` })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(SLACK_PORT, '127.0.0.1', resolve)
  })
  return server
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (await portIsOpen(SLACK_PORT)) throw new Error(`port ${SLACK_PORT} is already in use`)
  const databaseAlreadyRunning = await portIsOpen(DATABASE_PORT)
  if (databaseAlreadyRunning && !process.env.CI) {
    throw new Error(`port ${DATABASE_PORT} is already in use`)
  }

  await rm(E2E_ROOT, { recursive: true, force: true })
  await mkdir(E2E_ROOT, { recursive: true })

  const containerName = `rudder-e2e-t12-${process.pid}`
  let startedDatabase = false
  let slackServer: Server | null = null

  async function cleanup(): Promise<void> {
    if (slackServer) await closeServer(slackServer)
    if (startedDatabase) run('docker', ['stop', containerName])
    await rm(E2E_ROOT, { recursive: true, force: true })
  }

  try {
    if (!databaseAlreadyRunning) {
      run('docker', [
        'run', '--detach', '--rm', '--name', containerName,
        '--env', 'POSTGRES_USER=rudder', '--env', 'POSTGRES_PASSWORD=rudder',
        '--env', 'POSTGRES_DB=rudder', '--publish', '127.0.0.1:5435:5432',
        'postgres:15-alpine@sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f',
      ])
      startedDatabase = true
      await waitForPostgres(containerName)
    }

    if (existsSync(join(PROJECT_ROOT, 'scripts/migrate.mjs'))) {
      run('node', ['scripts/migrate.mjs'])
    } else {
      run('npx', ['drizzle-kit', 'migrate'])
    }

    await seedFixtureUsers()

    // Real onboarding fills slackUserId through the crew screen (an admin
    // edits it through the narrow users API). Driving that UI just to
    // seed a fixture would make every issue-flow spec depend on the crew
    // screen, so we write the column directly instead — the same shortcut the
    // old CSV seed took, which also bypassed the API. `postgres` here
    // is a plain one-off client (mirrors scripts/migrate.mjs's own usage),
    // deliberately not the app's cached getDb() singleton.
    const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
    await sql`update users set slack_user_id = ${E2E_USER_SLACK_ID} where email = ${E2E_USERS.user.email}`
    await sql.end()

    const captures: SlackCapture[] = []
    slackServer = await startSlackServer(captures)
    return cleanup
  } catch (error) {
    await cleanup()
    throw error
  }
}
