// @vitest-environment jsdom
// The grooming panel's recovery state machine has regressed three times (a
// committed transition being forgotten, a refresh button destroying the only
// retry control, then the cleanup refetch missing every implicit close), so it
// gets component tests where the rest of the .tsx layer gets a smoke walk.
// Scope is deliberately narrow: what breaks if the committed/uncommitted split
// or its single refetch owner regresses, nothing else.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the modules, not the network topology. useMe/useTopbarActions need a
// <Shell> ancestor otherwise; new-issue pulls in next/navigation, and the
// node it registers is never rendered here anyway.
vi.mock('@/ui/shell', () => ({
  useMe: () => ({ id: 1, email: 'hansol@tyche.test', name: '김한솔', role: 'admin', banned: false, slackUserId: null }),
  useTopbarActions: () => {},
}))
vi.mock('@/ui/new-issue', () => ({ NewIssueButton: () => null }))

import InboxPage from '@/app/(app)/inbox/page'

const ISSUE = {
  id: 1,
  title: '재고 동기화가 멈춥니다',
  description: '',
  type: 'bug',
  productId: 1,
  status: 'inbox',
  priority: null,
  requesterId: 2,
  assigneeId: null,
  milestoneId: null,
  sortOrder: null,
  reason: null,
  version: 1,
  createdAt: '2026-07-30T01:00:00.000Z',
  updatedAt: '2026-07-30T01:00:00.000Z',
}
const ISSUE_B = { ...ISSUE, id: 2, title: '주문 목록이 느립니다' }

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) })
const fail = (status: number, error: string) => ({ ok: false, status, json: async () => ({ ok: false, error }) })

// The issues route keeps returning the inbox rows even after a committed
// transition — that stale-list condition is where the reopen bug lives, and
// without it the reopen scenario is unreachable. It also means the refetch
// assertions below have to count GETs rather than watch a row disappear.
function stubApi(opts: {
  issues?: unknown[]
  transition?: () => unknown
  patch?: () => unknown
  // The single-issue GET (Task 9's committed-mode conflict recovery) — not
  // the same endpoint as the inbox list above, and deliberately so: it's how
  // a committed panel learns the server's actual current version without
  // refetching the whole list and dropping the already-backlog row.
  detail?: () => unknown
} = {}) {
  // patchBodies lives on the same object as the counters (not spread into a
  // copy on return) — the counters are mutated in place by the closure below
  // after stubApi returns, so a spread copy would freeze them at 0.
  const calls = { inbox: 0, transition: 0, patch: 0, detail: 0, patchBodies: [] as Array<Record<string, unknown>> }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (path.startsWith('/api/v1/products')) return ok([{ id: 1, name: 'lpa-collected', active: true }])
    if (path.startsWith('/api/v1/users')) return ok([{ id: 1, name: '김한솔' }, { id: 2, name: '박지연' }])
    if (path.startsWith('/api/v1/milestones')) return ok([{ id: 7, name: '2026 Q3' }])
    if (path.startsWith('/api/v1/issues?')) {
      calls.inbox += 1
      return ok(opts.issues ?? [ISSUE])
    }
    if (method === 'POST' && /^\/api\/v1\/issues\/\d+\/transition$/.test(path)) {
      calls.transition += 1
      return (opts.transition ?? (() => ok(ISSUE)))()
    }
    if (method === 'PATCH' && /^\/api\/v1\/issues\/\d+$/.test(path)) {
      calls.patch += 1
      calls.patchBodies.push(JSON.parse(init?.body as string))
      return (opts.patch ?? (() => ok(ISSUE)))()
    }
    if (method === 'GET' && /^\/api\/v1\/issues\/\d+$/.test(path)) {
      calls.detail += 1
      return (opts.detail ?? (() => ok({ issue: ISSUE, comments: [], events: [], relations: [], attachments: [] })))()
    }
    throw new Error(`unrouted ${method} ${path}`)
  }))
  return calls
}

// Pick P1 + 담당자 in the one open panel and fire 통관.
function pickAndSubmit() {
  fireEvent.click(screen.getByRole('radio', { name: 'P1' }))
  fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'P1으로 통관' }))
}

async function groomAndCommit() {
  render(<InboxPage />)
  fireEvent.click(await screen.findByRole('button', { name: '통관' }))
  await screen.findByRole('radio', { name: 'P1' })
  pickAndSubmit()
}

const retryButton = () => screen.queryByRole('button', { name: '담당자·마일스톤 다시 저장' })
const CLOSE_WARNING = /닫으면 저장되지 않은 담당자·마일스톤 지정은 사라집니다\./

// A POST that stays in flight until the test resolves it — the pending window
// is where the panel can lose the open slot before its commit is known.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

// Every "exactly once" count below needs this: waitFor stops at the first
// matching poll, so a duplicate refetch queued right behind the expected one
// would never be observed. A macrotask boundary lets it land first.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('inbox grooming — partial-success recovery', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('a committed transition with a failed PATCH switches to retry-only and says so', async () => {
    const calls = stubApi({ patch: () => fail(500, 'boom') })
    await groomAndCommit()

    expect(await screen.findByText(/담당자·마일스톤 지정에 실패했습니다/)).toBeTruthy()
    // The picks are still in panel state here, so retry must be usable —
    // only a reopened panel (test below) legitimately starts disabled.
    expect(retryButton()?.hasAttribute('disabled')).toBe(false)
    // Abandonment has to be an informed choice, so the warning is on screen
    // before 닫기 is ever clicked.
    expect(screen.getByText(CLOSE_WARNING)).toBeTruthy()
    // The issue already left 입항 대기 — re-offering these would send
    // backlog -> backlog (422), or reject an issue in the wrong context.
    expect(screen.queryByRole('button', { name: '반송' })).toBeNull()
    expect(screen.queryByRole('button', { name: '정박' })).toBeNull()
    expect(screen.queryByRole('button', { name: /통관/ })).toBeNull()
    expect(calls.transition).toBe(1)
    expect(calls.patch).toBe(1)
  })

  it('keeps the panel in committed mode after 닫기 and reopen', async () => {
    stubApi({ patch: () => fail(500, 'boom') })
    await groomAndCommit()
    await waitFor(() => expect(retryButton()).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(retryButton()).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))

    // Fails if committed-ness moves back into GroomingPanel's own state.
    expect(await screen.findByText(/이미 통관되었습니다/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '반송' })).toBeNull()
    expect(screen.queryByRole('button', { name: '정박' })).toBeNull()
    // The picks unmounted with the panel, so there is no PATCH body to send.
    expect(retryButton()?.hasAttribute('disabled')).toBe(true)
  })

  it('offers retry but not 새로고침 when the post-commit PATCH conflicts', async () => {
    stubApi({ patch: () => fail(409, '다른 사용자가 먼저 이 이슈를 변경했습니다') })
    await groomAndCommit()

    await waitFor(() => expect(retryButton()).not.toBeNull())
    // 새로고침 here would drop the already-backlog row and take the retry
    // control with it, leaving the assignment permanently unsaved.
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull()
  })

  it('still offers 새로고침 when the transition itself conflicts', async () => {
    stubApi({ transition: () => fail(409, '다른 사용자가 먼저 이 이슈를 변경했습니다') })
    await groomAndCommit()

    // Nothing committed, so the list really is stale and refreshing is right.
    expect(await screen.findByRole('button', { name: '새로고침' })).toBeTruthy()
    expect(retryButton()).toBeNull()
    expect(screen.getByRole('button', { name: '반송' })).toBeTruthy()
  })
})

// The stale row must stop being listed once its panel loses the open slot,
// however it loses it. Both paths route through InboxPage's openId effect;
// wiring either one back into a row's own onToggle fails the switch-row test.
describe('inbox grooming — the committed row stops lying', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('refetches exactly once when a committed panel is closed', async () => {
    const calls = stubApi({ patch: () => fail(500, 'boom') })
    await groomAndCommit()
    await waitFor(() => expect(retryButton()).not.toBeNull())
    const before = calls.inbox

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(calls.inbox).toBe(before + 1))
    await waitFor(() => expect(retryButton()).toBeNull())
    expect(calls.inbox).toBe(before + 1)
  })

  it('refetches when a committed panel is closed by opening a different row', async () => {
    const calls = stubApi({ issues: [ISSUE, ISSUE_B], patch: () => fail(500, 'boom') })
    render(<InboxPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: '통관' }))[0])
    await screen.findByRole('radio', { name: 'P1' })
    pickAndSubmit()
    await waitFor(() => expect(retryButton()).not.toBeNull())
    const before = calls.inbox

    // Row A now reads 닫기 and its committed panel offers no 통관, so the only
    // 통관 left is row B's. Clicking it runs B's onToggle, never A's — the
    // page-level effect is the only thing that can notice A closed.
    fireEvent.click(screen.getByRole('button', { name: '통관' }))

    await waitFor(() => expect(calls.inbox).toBe(before + 1))
    await settle()
    expect(calls.inbox).toBe(before + 1)
  })

  it('does not refetch when an uncommitted panel is closed', async () => {
    const calls = stubApi()
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))
    await screen.findByRole('radio', { name: 'P1' })
    const before = calls.inbox

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    expect(calls.inbox).toBe(before)
  })

  it('refetches once on the clean path, where onDone only closes the panel', async () => {
    const calls = stubApi()
    await groomAndCommit()

    // transition + PATCH both succeed -> onCommitted, then onDone sets
    // openId to null and the effect does the single refetch.
    await waitFor(() => expect(calls.patch).toBe(1))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    await waitFor(() => expect(calls.inbox).toBe(2))
    expect(calls.inbox).toBe(2)
  })

  // Nothing stops the admin from closing a row mid-POST — 닫기 and the other
  // rows' 통관 stay enabled while the transition is in flight. The close is
  // then observed before the commit, so the effect has to remember the id and
  // refetch when the commit finally shows up.
  it('refetches when the transition commits after its own panel already closed', async () => {
    const gate = deferred<unknown>()
    const calls = stubApi({ transition: () => gate.promise })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'P1' }))
    fireEvent.click(screen.getByRole('button', { name: 'P1으로 통관' }))
    const before = calls.inbox

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    // Still uncommitted, so closing alone is correctly not a reason to refetch.
    expect(calls.inbox).toBe(before)

    gate.resolve(ok(ISSUE))

    await waitFor(() => expect(calls.inbox).toBe(before + 1))
    await settle()
    expect(calls.inbox).toBe(before + 1)
  })

  // Opening a row just to read the description and closing it again is the
  // common case, not an edge one — and it must leave nothing behind that fires
  // over the panel when that same row is groomed for real later. A refetch
  // there blanks the page (loading -> null) and takes the retry UI with it if
  // the assignment PATCH then fails.
  it('does not refetch over an open panel whose row had been closed once before', async () => {
    const gate = deferred<unknown>()
    const calls = stubApi({ patch: () => gate.promise })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))
    await screen.findByRole('radio', { name: 'P1' })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '통관' }))
    await screen.findByRole('radio', { name: 'P1' })
    const before = calls.inbox
    pickAndSubmit()

    // Committed with the panel still open and the PATCH in flight. settle()
    // first: a refetch queued at commit time lands an async stage later, so
    // asserting immediately would miss it.
    await waitFor(() => expect(retryButton()).not.toBeNull())
    await settle()
    expect(calls.inbox).toBe(before)
    expect(retryButton()).not.toBeNull()
    expect(screen.getByLabelText('담당자')).toBeTruthy()

    gate.resolve(ok(ISSUE))

    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    await waitFor(() => expect(calls.inbox).toBe(before + 1))
    await settle()
    expect(calls.inbox).toBe(before + 1)
  })

  it('refetches when a mid-POST panel is closed by opening a different row', async () => {
    const gate = deferred<unknown>()
    const calls = stubApi({ issues: [ISSUE, ISSUE_B], transition: () => gate.promise })
    render(<InboxPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: '통관' }))[0])
    fireEvent.click(await screen.findByRole('radio', { name: 'P1' }))
    fireEvent.click(screen.getByRole('button', { name: 'P1으로 통관' }))
    const before = calls.inbox

    // Row A reads 닫기 while open, so the only 통관 left is row B's.
    fireEvent.click(screen.getByRole('button', { name: '통관' }))
    await waitFor(() => expect(screen.getByLabelText('마일스톤').id).toBe('ms-2'))

    gate.resolve(ok(ISSUE))

    await waitFor(() => expect(calls.inbox).toBe(before + 1))
    // Row A's transition finishing must not close row B: its onDone fires long
    // after its own panel is gone.
    await waitFor(() => expect(screen.getByLabelText('마일스톤').id).toBe('ms-2'))
    await settle()
    expect(calls.inbox).toBe(before + 1)
    expect(screen.getByLabelText('마일스톤').id).toBe('ms-2')
  })
})

// Task 4: the follow-up assignment PATCH must send the version the
// transition just committed, not issue's stale pre-transition version — the
// parent's issues list isn't refetched until the panel closes, so `issue`
// here is one version behind by the time patchAssignment runs.
describe('inbox grooming — expectedVersion threading', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('sends the post-transition version in the follow-up assignment PATCH', async () => {
    const calls = stubApi({ transition: () => ok({ ...ISSUE, status: 'backlog', priority: 'p1', version: 2 }) })
    await groomAndCommit()

    await waitFor(() => expect(calls.patch).toBe(1))
    expect(calls.patchBodies[0]).toMatchObject({ expectedVersion: 2 })
  })

  it('keeps sending the post-transition version in the retry PATCH after 닫기-then-reopen (Task 9)', async () => {
    // Before Task 9: committedVersionRef is a useRef inside GroomingPanel —
    // it resets to null on every remount. A 닫기-then-reopen of an already-
    // committed row started a fresh mount with no committed version to
    // reuse, so its retry PATCH fell back to issue.version (1, the parent's
    // still-stale list snapshot) instead of the version the transition
    // actually committed to (2 here) — a guaranteed 409 with no way out but
    // abandoning the picks (this was the old pin, and the old bug).
    //
    // Task 9 lifts the committed version into InboxPage's committedVersions,
    // which outlives the remount (unlike GroomingPanel's own
    // committedVersionRef) — this pins that the reopened panel's retry now
    // sends the version that was actually committed, not issue.version.
    const calls = stubApi({
      transition: () => ok({ ...ISSUE, status: 'backlog', priority: 'p1', version: 2 }),
      patch: () => fail(500, 'boom'),
    })
    await groomAndCommit()
    await waitFor(() => expect(calls.patch).toBe(1))
    expect(calls.patchBodies[0]).toMatchObject({ expectedVersion: 2 })

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))

    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '2' } })
    fireEvent.click(await screen.findByRole('button', { name: '담당자·마일스톤 다시 저장' }))

    await waitFor(() => expect(calls.patch).toBe(2))
    expect(calls.patchBodies[1]).toMatchObject({ expectedVersion: 2 })
  })
})

// Task 9: an unmounted GroomingPanel instance (its row closed, possibly then
// reopened as a brand-new instance for the same issue) must not act on the
// page anymore — a stale onDone would close a panel it has no business
// touching — and a committed-mode version conflict must have a real,
// input-preserving way out instead of a retry button that 409s forever.
describe('inbox grooming — stale completions after close (Task 9)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // Characterization (a) from the brief: the CROSS-row case. Commit 5fd56f5
  // (Phase 2, T6 round 4) already scoped onDone to its own issue.id, so this
  // is expected to pass on unfixed-for-Task-9 code too — pinned here as its
  // own test (distinct from the pre-existing "closed by opening a different
  // row" test below, which closes A only implicitly) so that fact has a
  // dedicated, explicit artifact rather than being inferred from a test whose
  // main point is refetch counting.
  it('a stale transition resolving after an explicit close does not touch a different, later-opened row', async () => {
    const gate = deferred<unknown>()
    stubApi({ issues: [ISSUE, ISSUE_B], transition: () => gate.promise })
    render(<InboxPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: '통관' }))[0])
    fireEvent.click(await screen.findByRole('radio', { name: 'P1' }))
    fireEvent.click(screen.getByRole('button', { name: 'P1으로 통관' }))

    // Close A explicitly (닫기), not by switching rows — A's transition POST
    // is still hanging.
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())

    // Now open B. Both rows read 통관 at this point (A reverted on close).
    fireEvent.click((await screen.findAllByRole('button', { name: '통관' }))[1])
    await waitFor(() => expect(screen.getByLabelText('마일스톤').id).toBe('ms-2'))

    gate.resolve(ok(ISSUE))
    await settle()

    // B's panel must still be the one on screen — A's stale completion must
    // not have reopened A or closed B.
    expect(screen.getByLabelText('마일스톤').id).toBe('ms-2')
  })

  // Characterization (b) from the brief: the SAME-row reopen case — what was
  // actually still broken. Expected to FAIL before the `alive` guard exists:
  // onDone only ever checked "is this row's slot still issue.id", which is
  // true again the moment the same row is reopened, so a stale completion
  // from the panel instance that existed before 닫기 closes the brand-new one.
  it('a stale PATCH resolving after 닫기-then-reopen does not close the freshly reopened panel', async () => {
    const gate = deferred<unknown>()
    stubApi({ patch: () => gate.promise })
    // groomAndCommit: P1 + assignee(2) submitted; transition (default
    // ok(ISSUE)) commits immediately, and the follow-up assignment PATCH
    // hangs on `gate` — the panel is now committed, mid-retry, still open.
    await groomAndCommit()
    await waitFor(() => expect(retryButton()).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: '통관' }))
    // A fresh mount, in committed mode (committedVersion survived) — confirms
    // this is the new instance, not the stale one, before the stale PATCH is
    // allowed to resolve.
    expect(await screen.findByText(/이미 통관되었습니다/)).toBeTruthy()

    gate.resolve(ok(ISSUE))
    await settle()

    // The reopened panel must still be open and in committed mode — a stale
    // onDone from the OLD (닫기-closed) instance must not have fired.
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy()
    expect(screen.getByText(/이미 통관되었습니다/)).toBeTruthy()
  })

  // Defect 3: a genuine version conflict in committed mode, independent of
  // any remount (the transition committed to version 2 in THIS mount; a
  // concurrent edit elsewhere bumped the server to 3 before the assignment
  // PATCH landed). Before Task 9 this had no escape: 새로고침 is gated off
  // whenever committed, so 다시 저장 alone kept re-sending the same stale
  // version forever. Task 9 makes the retry itself re-sync — a single-issue
  // GET, not the whole inbox list (which would drop the row and the picks
  // with it) — whenever the last attempt conflicted, then retries.
  it('recovers from a genuine committed-mode conflict by re-syncing before the retry, without losing the picks', async () => {
    let patchAttempt = 0
    const calls = stubApi({
      transition: () => ok({ ...ISSUE, status: 'backlog', priority: 'p1', version: 2 }),
      patch: () => {
        patchAttempt += 1
        return patchAttempt === 1 ? fail(409, '다른 사용자가 먼저 이 이슈를 변경했습니다') : ok(ISSUE)
      },
      detail: () => ok({ issue: { ...ISSUE, version: 3 }, comments: [], events: [], relations: [], attachments: [] }),
    })
    await groomAndCommit()

    expect(await screen.findByText(/담당자·마일스톤 지정에 실패했습니다/)).toBeTruthy()
    // No separate escape hatch — the whole-list 새로고침 stays hidden exactly
    // as the pre-existing 'offers retry but not 새로고침' test pins; the same
    // retry button has to be the one that recovers.
    expect(screen.queryByRole('button', { name: '새로고침' })).toBeNull()
    expect(screen.getByLabelText('담당자')).toBeTruthy() // picks still on screen, not discarded

    fireEvent.click(retryButton()!)

    await waitFor(() => expect(calls.detail).toBe(1))
    await waitFor(() => expect(calls.patch).toBe(2))
    expect(calls.patchBodies[1]).toMatchObject({ expectedVersion: 3, assigneeId: 2 })
    // Succeeded this time -> onDone -> panel closes.
    await waitFor(() => expect(screen.queryByRole('button', { name: '닫기' })).toBeNull())
  })

  // Round 1 review finding: the recovery above is gated on `committed`, not
  // on this mount's own `conflict` state — `conflict` is local and resets to
  // false on every remount, so gating on it (the first cut) would skip the
  // re-sync on a reopened panel's very FIRST retry click (no failed attempt
  // of its own yet), sending the already-known-stale committedVersion again
  // and 409ing a second time before a second click finally re-synced.
  it('re-syncs on the very first retry after 닫기-then-reopen, not only after that reopened panel has already conflicted once itself', async () => {
    // Between the panel closing and reopening, a concurrent edit bumps the
    // server to version 3 — independent of the remount itself.
    let patchAttempt = 0
    const calls = stubApi({
      transition: () => ok({ ...ISSUE, status: 'backlog', priority: 'p1', version: 2 }),
      patch: () => {
        patchAttempt += 1
        // 1st (mount A, correct version 2 at the time): an unrelated
        // hiccup, not a version problem — leaves the panel in retry mode so
        // it can be closed and reopened. 2nd+ (mount B, reopened): succeeds
        // regardless of what version arrives, so the assertions below (not
        // "did it eventually succeed") are what tell first-click-correct
        // apart from first-click-wrong-then-second-click-correct.
        return patchAttempt === 1 ? fail(500, 'boom') : ok(ISSUE)
      },
      detail: () => ok({ issue: { ...ISSUE, version: 3 }, comments: [], events: [], relations: [], attachments: [] }),
    })
    await groomAndCommit()
    await waitFor(() => expect(calls.patch).toBe(1))
    expect(calls.patchBodies[0]).toMatchObject({ expectedVersion: 2 })

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'P1' })).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '통관' }))

    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '2' } })
    // One click. If the re-sync were gated on this fresh mount's own
    // (false) conflict flag, this click would send expectedVersion:2 again
    // (a second, avoidable 409) instead of re-syncing to 3 first.
    fireEvent.click(await screen.findByRole('button', { name: '담당자·마일스톤 다시 저장' }))

    await waitFor(() => expect(calls.detail).toBe(1))
    await waitFor(() => expect(calls.patch).toBe(2))
    expect(calls.patchBodies[1]).toMatchObject({ expectedVersion: 3, assigneeId: 2 })
  })
})
