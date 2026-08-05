// @vitest-environment jsdom
// login/page.tsx moved off the retired portalId/password route onto
// better-auth's client (google + email/password). This drives the real
// module: field rendering, the email/password submit path (generic error on
// failure regardless of shape, full navigation on success), the Google
// button, and the ?error=google round trip for an uninvited account.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
  },
}))

import { authClient } from '@/lib/auth-client'
import LoginPage from '@/app/login/page'

// jsdom's window.location.assign isn't configurable, so vi.spyOn can't wrap
// it directly — swap the whole location object out for the duration of each
// test (mirrors tests/ui/shell.test.tsx's LogoutButton helper).
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
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
})

describe('LoginPage — fields', () => {
  it('renders email + password inputs and a Google button', () => {
    stubLocationAssign()
    render(<LoginPage />)
    expect(screen.getByLabelText('이메일')).toHaveProperty('type', 'email')
    expect(screen.getByLabelText('비밀번호')).toHaveProperty('type', 'password')
    expect(screen.getByRole('button', { name: /Google/ })).toBeTruthy()
  })
})

describe('LoginPage — email/password submit', () => {
  it('shows a generic error and does not navigate when the server rejects the credentials', async () => {
    // The realistic shape: better-auth's client resolves { data, error } on
    // an HTTP-level auth failure, it does not reject.
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: null, error: { message: 'INVALID_EMAIL_OR_PASSWORD' } } as never)
    const assign = stubLocationAssign()
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'ghost@tyche.test' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong-pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByText('이메일 또는 비밀번호가 올바르지 않습니다')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect(authClient.signIn.email).toHaveBeenCalledWith({ email: 'ghost@tyche.test', password: 'wrong-pw' })
  })

  it('shows the same generic error on a network-level rejection', async () => {
    vi.mocked(authClient.signIn.email).mockRejectedValue(new Error('network down'))
    const assign = stubLocationAssign()
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'u@tyche.test' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByText('이메일 또는 비밀번호가 올바르지 않습니다')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('navigates to /inbox with a full page load on success', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ data: { user: {} }, error: null } as never)
    const assign = stubLocationAssign()
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'u@tyche.test' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'correct-pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/inbox'))
  })
})

describe('LoginPage — Google sign-in', () => {
  it('calls signIn.social with the provider/callback/error-callback triple', () => {
    vi.mocked(authClient.signIn.social).mockResolvedValue({ data: null, error: null } as never)
    stubLocationAssign()
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: /Google/ }))
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/inbox',
      errorCallbackURL: '/login?authError=google',
    })
  })

  it('shows an error when the initial request resolves with { error } (e.g. provider not configured)', async () => {
    // The realistic shape: better-auth's client resolves { data, error } on
    // an HTTP-level failure, it does not reject.
    vi.mocked(authClient.signIn.social).mockResolvedValue({ data: null, error: { message: 'PROVIDER_NOT_FOUND' } } as never)
    stubLocationAssign()
    render(<LoginPage />)

    const button = screen.getByRole('button', { name: /Google/ })
    fireEvent.click(button)

    expect(await screen.findByText('구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.')).toBeTruthy()
    expect(button).toHaveProperty('disabled', false)
  })

  it('shows the same error on a network-level rejection', async () => {
    vi.mocked(authClient.signIn.social).mockRejectedValue(new Error('network down'))
    stubLocationAssign()
    render(<LoginPage />)

    fireEvent.click(screen.getByRole('button', { name: /Google/ }))

    expect(await screen.findByText('구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.')).toBeTruthy()
  })

  it('disables the button while the request is in flight', async () => {
    let resolveFn: (v: unknown) => void = () => {}
    vi.mocked(authClient.signIn.social).mockReturnValue(new Promise((resolve) => { resolveFn = resolve }) as never)
    stubLocationAssign()
    render(<LoginPage />)

    const button = screen.getByRole('button', { name: /Google/ })
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveProperty('disabled', true))

    resolveFn({ data: null, error: null })
  })
})

describe('LoginPage — Google OAuth callback round trip', () => {
  // errorCallbackURL uses authError=google as our own marker — a key
  // distinct from `error` — so better-auth's callback handler appending its
  // own error=<code> (redirectOnError never replaces an existing query key)
  // lands as /login?authError=google&error=<code> with no key collision:
  // `error` is read directly, with its real value, no ordering games.
  it('shows the "check invitation" message for signup_disabled', () => {
    stubLocationAssign('?authError=google&error=signup_disabled')
    render(<LoginPage />)
    expect(screen.getByText('구글 로그인에 실패했습니다. 초대된 계정인지 확인해 주세요.')).toBeTruthy()
  })

  it('shows nothing when the user simply cancelled at the Google consent screen', () => {
    stubLocationAssign('?authError=google&error=access_denied')
    render(<LoginPage />)
    expect(screen.queryByText(/구글 로그인/)).toBeNull()
  })

  it('shows a generic failure message for any other callback error code', () => {
    stubLocationAssign('?authError=google&error=email_doesnt_match')
    render(<LoginPage />)
    expect(screen.getByText('구글 로그인에 실패했습니다. 다시 시도해 주세요.')).toBeTruthy()
  })

  it('shows nothing when there is no error param', () => {
    stubLocationAssign('')
    render(<LoginPage />)
    expect(screen.queryByText(/구글 로그인/)).toBeNull()
  })

  it('ignores an error param that did not come from our Google marker', () => {
    // Defense in depth: an unrelated ?error=... on this page (a stale
    // bookmark, a copy-pasted link) must not trigger a Google-specific
    // message just because the key name matches.
    stubLocationAssign('?error=signup_disabled')
    render(<LoginPage />)
    expect(screen.queryByText(/구글 로그인/)).toBeNull()
  })
})
