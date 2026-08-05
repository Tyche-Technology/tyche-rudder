import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, seedUser } from '../helpers/db'
import type { Db } from '@/db/client'
import type { Issue } from '@/db/schema'
import { notifyNewIssue, notifyStatusChange } from '@/lib/slack'

const ENV_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'APP_BASE_URL', 'SLACK_API_BASE', 'RUDDER_E2E'] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

function fakeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 42, title: '테스트 이슈', description: '', type: 'bug', productId: 1,
    status: 'backlog', priority: 'p1', requesterId: 1, assigneeId: null,
    milestoneId: null, sortOrder: null, reason: null, version: 1,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
}

// A tick past the current microtask queue — enough for post()'s internal
// `await fetch(...)` / `await res.json()` chain to settle before assertions.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
  process.env.SLACK_API_BASE = 'https://attacker.example/api'
  process.env.RUDDER_E2E = 'true'
  process.env.APP_BASE_URL = 'http://rudder.test'
  process.env.SLACK_CHANNEL_ID = 'C_TEST_CHANNEL'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notifyNewIssue', () => {
  it('posts only to Slack\'s fixed endpoint with the configured channel and #id/title/url text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    notifyNewIssue(fakeIssue({ id: 7, title: '통관 지연' }))
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(opts.headers.authorization).toBe('Bearer xoxb-test-token')
    const body = JSON.parse(opts.body)
    expect(body.channel).toBe('C_TEST_CHANNEL')
    expect(body.text).toContain('#7')
    expect(body.text).toContain('통관 지연')
    expect(body.text).toContain('http://rudder.test/issues/7')
  })

  it('uses SLACK_CHANNEL_ID when set', async () => {
    process.env.SLACK_CHANNEL_ID = 'C_CUSTOM'
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    notifyNewIssue(fakeIssue())
    await tick()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.channel).toBe('C_CUSTOM')
  })

  it('makes no fetch call when SLACK_BOT_TOKEN is missing', async () => {
    delete process.env.SLACK_BOT_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    notifyNewIssue(fakeIssue())
    await tick()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('makes no fetch call when SLACK_CHANNEL_ID is missing', async () => {
    delete process.env.SLACK_CHANNEL_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    notifyNewIssue(fakeIssue())
    await tick()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a rejected fetch resolves without throwing and produces no unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(() => notifyNewIssue(fakeIssue())).not.toThrow()
    await tick()
    expect(onUnhandled).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    process.off('unhandledRejection', onUnhandled)
  })

  it('a { ok: false } Slack response logs but does not throw', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'invalid_auth' }) }))
    expect(() => notifyNewIssue(fakeIssue())).not.toThrow()
    await tick()
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('notifyStatusChange', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('DMs the requester with old→new labels when they have a slackUserId', async () => {
    const requester = await seedUser(db, { slackUserId: 'U01ABCDEFGH' })
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const issue = fakeIssue({ id: 9, requesterId: requester.id, status: 'in_progress' })
    notifyStatusChange(db, issue, 'backlog')
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.channel).toBe('U01ABCDEFGH')
    expect(body.text).toContain('선적 대기 → 항해 중')
    expect(body.text).toContain('#9')
  })

  // Slack's `channel` accepts channel ids (C…), group ids (G…) and #name just
  // as readily as a user id, so a wrong-shaped value here would publish a
  // user's issue activity into a conversation instead of DMing them. The
  // narrow write route validates too, but the consumer keeps this check so a
  // direct database mistake cannot redirect private issue activity.
  it.each(['C01TESTCHAN1', '#general', 'G01SECRETGRP', 'u01lowercase', '  ', 'U123'])(
    'sends nothing when slackUserId is not a user id (%j)', async (bad) => {
      const requester = await seedUser(db, { slackUserId: bad })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      // A mistyped id must be distinguishable from an unmapped user in the
      // logs — the skip is otherwise invisible in production.
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      notifyStatusChange(db, fakeIssue({ requesterId: requester.id }), 'inbox')
      await tick()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(String(requester.id)))
      errorSpy.mockRestore()
    })

  it('sends nothing when the requester has no slackUserId (unmapped, silent)', async () => {
    const requester = await seedUser(db)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    notifyStatusChange(db, fakeIssue({ requesterId: requester.id }), 'inbox')
    await tick()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled() // opting out is not an error, unlike a typo
    errorSpy.mockRestore()
  })

  it('a rejected fetch resolves without throwing and produces no unhandled rejection', async () => {
    const requester = await seedUser(db, { slackUserId: 'U01ABCDEFGH' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(() => notifyStatusChange(db, fakeIssue({ requesterId: requester.id }), 'inbox')).not.toThrow()
    await tick()
    expect(onUnhandled).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    process.off('unhandledRejection', onUnhandled)
  })

  it('a failing requester lookup (db rejects) resolves without throwing and produces no unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    const throwingDb = {
      select: () => ({ from: () => ({ where: () => Promise.reject(new Error('db down')) }) }),
    } as unknown as Db
    expect(() => notifyStatusChange(throwingDb, fakeIssue(), 'inbox')).not.toThrow()
    await tick()
    expect(onUnhandled).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    process.off('unhandledRejection', onUnhandled)
  })
})
