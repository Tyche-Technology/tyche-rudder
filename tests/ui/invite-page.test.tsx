// @vitest-environment jsdom
// /invite/[token] — the screen an invited person lands on. Exercises the
// real @/ui/api (api/useApi) against a stubbed global fetch, same convention
// as tests/ui/issue-detail-version.test.tsx, so the test proves real
// envelope-unwrapping behavior rather than a mocked module's promises.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const TOKEN = 'a'.repeat(64)

vi.mock('next/navigation', () => ({ useParams: () => ({ token: TOKEN }) }))
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: vi.fn(), signIn: { social: vi.fn() } },
}))

import { authClient } from '@/lib/auth-client'
import InvitePage from '@/app/invite/[token]/page'

const NO_SESSION = { data: null, isPending: false }

function envelope(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function stubFetch(handler: (path: string, init?: RequestInit) => ReturnType<typeof envelope>) {
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => handler(path, init)))
}

const originalLocation = window.location

function stubLocationAssign(search = '') {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, assign, search },
    writable: true,
    configurable: true,
  })
  return assign
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
})

describe('InvitePage — pending', () => {
  it('renders the greeting, email, Google button, and an 8-char password form', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign()
    stubFetch((path) => {
      expect(path).toBe(`/api/v1/invites/${TOKEN}`)
      return envelope(200, { ok: true, data: { email: 'status@test.local', name: '상태조회', status: 'pending' } })
    })

    render(<InvitePage />)

    expect(await screen.findByText('상태조회님, Rudder에 오신 것을 환영합니다')).toBeTruthy()
    expect(screen.getByText('status@test.local')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Google/ })).toBeTruthy()
    expect(screen.getByLabelText('비밀번호')).toHaveProperty('minLength', 8)
    expect(screen.getByRole('button', { name: '비밀번호 설정' })).toBeTruthy()
  })
})

describe('InvitePage — used / expired', () => {
  it.each(['used', 'expired'] as const)('renders the guidance message and no form for status=%s', async (status) => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign()
    stubFetch(() => envelope(200, { ok: true, data: { email: 'gone@test.local', name: '지나감', status } }))

    render(<InvitePage />)

    expect(await screen.findByText(/관리자에게 새 초대 링크를 요청해 주세요/)).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
  })
})

describe('InvitePage — unknown token', () => {
  it('renders the invalid-invite message and no form on a 404', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign()
    stubFetch(() => envelope(404, { ok: false, error: '유효하지 않은 초대장입니다' }))

    render(<InvitePage />)

    expect(await screen.findByText('유효하지 않은 초대장입니다')).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
  })
})

describe('InvitePage — password form submit', () => {
  it('POSTs accept with {token,password} and navigates to /inbox on 200', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    const assign = stubLocationAssign()
    const acceptBodies: Array<Record<string, unknown>> = []
    stubFetch((path, init) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '수락', status: 'pending' } })
      }
      if (path === '/api/v1/invites/accept' && init?.method === 'POST') {
        acceptBodies.push(JSON.parse(init.body as string))
        return envelope(200, { ok: true, data: { id: 1, email: 'accept@test.local', name: '수락', role: 'user' } })
      }
      throw new Error(`unrouted ${init?.method ?? 'GET'} ${path}`)
    })

    render(<InvitePage />)
    await screen.findByLabelText('비밀번호')
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'fresh-anchor-99' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/inbox'))
    expect(acceptBodies).toEqual([{ token: TOKEN, password: 'fresh-anchor-99' }])
  })

  it('switches to the expired/used guidance message on a 410 and drops the form', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    const assign = stubLocationAssign()
    stubFetch((path, init) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'once@test.local', name: '한번', status: 'pending' } })
      }
      if (path === '/api/v1/invites/accept') return envelope(410, { ok: false, error: '만료되었거나 이미 사용된 초대장입니다' })
      throw new Error(`unrouted ${path}`)
    })

    render(<InvitePage />)
    await screen.findByLabelText('비밀번호')
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'second-try-pw-2' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))

    expect(await screen.findByText(/관리자에게 새 초대 링크를 요청해 주세요/)).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows the exact banned-account message from the server on a 403 and keeps the form', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    const assign = stubLocationAssign()
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'banned@test.local', name: '금지', status: 'pending' } })
      }
      return envelope(403, { ok: false, error: '비활성화된 계정입니다' })
    })

    render(<InvitePage />)
    await screen.findByLabelText('비밀번호')
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'banned-pw-123' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))

    expect(await screen.findByText('비활성화된 계정입니다')).toBeTruthy()
    expect(screen.getByLabelText('비밀번호')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('renders the exact sign-in-again guidance when accept returns 200 with ok:false, with a real way to /login and no dead-end retry', async () => {
    // The one case the brief calls out by name: password set successfully,
    // but the follow-up signInEmail failed server-side. api.ts only replaces
    // the message for status >= 500, so this 200 carries the real guidance
    // through untouched — the page must show it verbatim, not a generic
    // "다시 시도해주세요". By this point the invite is already spent
    // server-side, so the form must not still be sitting there offering a
    // retry that would only 410 into "ask the admin for a new invite" — a
    // lie for a user whose account already works.
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    const assign = stubLocationAssign()
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'signin-fail@test.local', name: '실패', status: 'pending' } })
      }
      return envelope(200, { ok: false, error: '비밀번호가 설정되었습니다. 로그인 페이지에서 다시 로그인해주세요.' })
    })

    render(<InvitePage />)
    await screen.findByLabelText('비밀번호')
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'signin-fail-pw1' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }))

    expect(await screen.findByText('비밀번호가 설정되었습니다. 로그인 페이지에서 다시 로그인해주세요.')).toBeTruthy()
    const loginLink = screen.getByRole('link', { name: /로그인/ })
    expect(loginLink.getAttribute('href')).toBe('/login')
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('InvitePage — active session matching the invite email', () => {
  it('POSTs consume and navigates to /inbox, comparing emails case/whitespace-insensitively', async () => {
    // Session email carries different casing/whitespace than the
    // (already-normalized) stored invite email — this exact mismatch class
    // has recurred before in this project, so the comparison must normalize
    // both sides rather than assume the session already matches verbatim.
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { email: ' Accept@Test.local ' } }, isPending: false,
    } as never)
    const assign = stubLocationAssign()
    const consumeBodies: Array<Record<string, unknown>> = []
    stubFetch((path, init) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '구글수락', status: 'pending' } })
      }
      if (path === '/api/v1/invites/consume' && init?.method === 'POST') {
        consumeBodies.push(JSON.parse(init.body as string))
        return envelope(200, { ok: true, data: null })
      }
      throw new Error(`unrouted ${init?.method ?? 'GET'} ${path}`)
    })

    render(<InvitePage />)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/inbox'))
    expect(consumeBodies).toEqual([{ token: TOKEN }])
    // A matching session must not also trip the mismatch warning below.
    expect(screen.queryByText(/계정으로 로그인되어 있습니다/)).toBeNull()
  })

  it('does not consume when the session email belongs to someone else', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { email: 'someone-else@test.local' } }, isPending: false,
    } as never)
    const assign = stubLocationAssign()
    // Measures whether the guard actually suppresses the call — asserting
    // only on `assign` would pass even with a broken guard, since a
    // wrongly-attempted consume POST would just fail quietly and never
    // reach the navigate step either.
    let consumeCalled = false
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '구글수락', status: 'pending' } })
      }
      consumeCalled = true
      return envelope(200, { ok: true, data: null })
    })

    render(<InvitePage />)
    await screen.findByText('구글수락님, Rudder에 오신 것을 환영합니다')
    // Let any stray effect fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0))

    expect(consumeCalled).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })

  it('warns plainly instead of silently rendering someone else\'s invite for the signed-in visitor', async () => {
    // The auto-consume guard above stops the *silent claim*, but says
    // nothing to a visitor who is already signed in as themselves and opens
    // a colleague's invite link — they should be told outright, before
    // anything is claimed, not left to submit the password form blind.
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { email: 'someone-else@test.local' } }, isPending: false,
    } as never)
    stubLocationAssign()
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '초대대상', status: 'pending' } })
      }
      return envelope(200, { ok: true, data: null })
    })

    render(<InvitePage />)

    const warning = await screen.findByText(/someone-else@test\.local 계정으로 로그인되어 있습니다/)
    expect(warning).toBeTruthy()
    // Plain .hint is the smallest, most muted text style in the system —
    // indistinguishable from routine field chrome. This specific warning
    // must carry the hazard modifier so a later refactor can't quietly
    // demote it back to routine-looking text.
    expect(warning.className).toContain('hint--danger')
  })
})

describe('InvitePage — auto-consume failure', () => {
  it('shows a terminal, actionable error instead of silently retrying forever', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { email: 'accept@test.local' } }, isPending: false,
    } as never)
    stubLocationAssign()
    let consumeCalls = 0
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '실패자', status: 'pending' } })
      }
      consumeCalls += 1
      return envelope(500, { ok: false, error: '서버 오류가 발생했습니다' })
    })

    render(<InvitePage />)

    expect(await screen.findByText(/초대 확인에 실패했습니다/)).toBeTruthy()
    // A broken fix (consuming reset to false with no terminal gate) would
    // re-trigger the effect immediately and keep calling consume — give it
    // a real chance to do that before asserting it only fired once.
    await new Promise((r) => setTimeout(r, 30))
    expect(consumeCalls).toBe(1)
  })

  it('lets the user retry once via the button, without auto-looping', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { email: 'accept@test.local' } }, isPending: false,
    } as never)
    const assign = stubLocationAssign()
    let consumeCalls = 0
    stubFetch((path) => {
      if (path === `/api/v1/invites/${TOKEN}`) {
        return envelope(200, { ok: true, data: { email: 'accept@test.local', name: '재시도자', status: 'pending' } })
      }
      consumeCalls += 1
      return consumeCalls === 1
        ? envelope(500, { ok: false, error: '서버 오류가 발생했습니다' })
        : envelope(200, { ok: true, data: null })
    })

    render(<InvitePage />)
    await screen.findByText(/초대 확인에 실패했습니다/)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/inbox'))
    expect(consumeCalls).toBe(2)
  })
})

describe('InvitePage — Google button', () => {
  it('calls signIn.social with a token-scoped callback and a dedicated-marker error callback', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    vi.mocked(authClient.signIn.social).mockResolvedValue({ data: null, error: null } as never)
    stubLocationAssign()
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g@test.local', name: '구글', status: 'pending' } }))

    render(<InvitePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Google/ }))

    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: `/invite/${TOKEN}`,
      errorCallbackURL: `/invite/${TOKEN}?authError=google`,
    })
  })

  it('shows an error when the initial request resolves with { error } (e.g. provider not configured)', async () => {
    // better-auth's client resolves { data, error } on an HTTP-level
    // failure — it does not reject. A bare .catch() alone (the pre-fix
    // shape) never sees this at all.
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    vi.mocked(authClient.signIn.social).mockResolvedValue({ data: null, error: { message: 'PROVIDER_NOT_FOUND' } } as never)
    stubLocationAssign()
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g4@test.local', name: '오류', status: 'pending' } }))

    render(<InvitePage />)
    const button = await screen.findByRole('button', { name: /Google/ })
    fireEvent.click(button)

    expect(await screen.findByText('구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.')).toBeTruthy()
    expect(button).toHaveProperty('disabled', false)
  })

  it('shows the same error on a network-level rejection', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    vi.mocked(authClient.signIn.social).mockRejectedValue(new Error('network down'))
    stubLocationAssign()
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g5@test.local', name: '네트워크', status: 'pending' } }))

    render(<InvitePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Google/ }))

    expect(await screen.findByText('구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.')).toBeTruthy()
  })

  it('disables the button while the request is in flight', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    let resolveFn: (v: unknown) => void = () => {}
    vi.mocked(authClient.signIn.social).mockReturnValue(new Promise((resolve) => { resolveFn = resolve }) as never)
    stubLocationAssign()
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g6@test.local', name: '대기', status: 'pending' } }))

    render(<InvitePage />)
    const button = await screen.findByRole('button', { name: /Google/ })
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveProperty('disabled', true))

    resolveFn({ data: null, error: null })
  })
})

describe('InvitePage — Google OAuth callback round trip', () => {
  // errorCallbackURL uses authError=google as our own marker key, distinct
  // from better-auth's own `error` — its callback handler always APPENDS
  // error=<code> after whatever query the errorCallbackURL already carries
  // (redirectOnError never replaces an existing key), so the real round
  // trip is /invite/{token}?authError=google&error=<code>. Because the
  // marker key never collides with `error`, `error` is read directly with
  // its real value — no ordering games needed to pick the right one.
  it('shows the invited-email guidance for signup_disabled', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign('?authError=google&error=signup_disabled')
    stubFetch(() => envelope(200, { ok: true, data: { email: 'ghost@test.local', name: '유령', status: 'pending' } }))

    render(<InvitePage />)

    expect(await screen.findByText(
      '구글 로그인에 실패했습니다. 초대된 이메일(ghost@test.local)의 구글 계정으로 시도해 주세요.',
    )).toBeTruthy()
  })

  it('shows nothing when the user simply cancelled at the Google consent screen', async () => {
    // A deliberate Cancel click (access_denied) is not a failure — scolding
    // the user for it is exactly the misattribution this fix removes.
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign('?authError=google&error=access_denied')
    stubFetch(() => envelope(200, { ok: true, data: { email: 'ghost2@test.local', name: '유령2', status: 'pending' } }))

    render(<InvitePage />)
    await screen.findByText('유령2님, Rudder에 오신 것을 환영합니다')
    expect(screen.queryByText(/구글 로그인/)).toBeNull()
  })

  it('shows a generic failure message for any other callback error code', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign('?authError=google&error=state_mismatch')
    stubFetch(() => envelope(200, { ok: true, data: { email: 'ghost3@test.local', name: '유령3', status: 'pending' } }))

    render(<InvitePage />)
    expect(await screen.findByText('구글 로그인에 실패했습니다. 다시 시도해 주세요.')).toBeTruthy()
  })

  it('shows nothing extra when there is no error param', async () => {
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign('')
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g2@test.local', name: '무오류', status: 'pending' } }))

    render(<InvitePage />)
    await screen.findByText('무오류님, Rudder에 오신 것을 환영합니다')
    expect(screen.queryByText(/구글 로그인에 실패했습니다/)).toBeNull()
  })

  it('ignores an error param that did not come from our Google marker', async () => {
    // Defense in depth: an unrelated ?error=... on this page (a stale
    // bookmark, a copy-pasted link) must not trigger a Google-specific
    // message just because the key name matches.
    vi.mocked(authClient.useSession).mockReturnValue(NO_SESSION as never)
    stubLocationAssign('?error=signup_disabled')
    stubFetch(() => envelope(200, { ok: true, data: { email: 'g3@test.local', name: '무관', status: 'pending' } }))

    render(<InvitePage />)
    await screen.findByText('무관님, Rudder에 오신 것을 환영합니다')
    expect(screen.queryByText(/구글 로그인/)).toBeNull()
  })
})
