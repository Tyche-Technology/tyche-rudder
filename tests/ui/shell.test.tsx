// @vitest-environment jsdom
// shell.tsx had zero coverage — every page mocks it away (`vi.mock('@/ui/shell', ...)`)
// rather than rendering the real thing, so its own auth-guard states, theme
// persistence, and logout flow were never exercised. This drives the real
// module: Shell's pending/no-session/success states, useMe's outside-guard,
// ThemeToggle's persistence (including a throwing localStorage), and
// LogoutButton's success/failure paths — now all against authClient rather
// than the retired /api/v1/auth/me + /api/v1/auth/logout routes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import type { ApiUser } from '@/ui/types'

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: vi.fn(), signOut: vi.fn() },
}))

import { authClient } from '@/lib/auth-client'
import { Shell, useMe, useTopbarActions, MeContext } from '@/ui/shell'

// The raw shape authClient.useSession() resolves — session.user, as
// better-auth's admin plugin + our slackUserId additionalField hand it back.
type SessionUser = { id: string; email: string; name: string; role: string; banned: boolean; slackUserId: string | null }

const RAW_ME: SessionUser = { id: '1', email: 'u1@tyche.test', name: '김한솔', role: 'user', banned: false, slackUserId: null }
const RAW_ADMIN: SessionUser = { id: '2', email: 'admin@tyche.test', name: '관리자', role: 'admin', banned: false, slackUserId: null }

const ME: ApiUser = { id: 1, email: 'u1@tyche.test', name: '김한솔', role: 'user', banned: false, slackUserId: null }

function mockSession(user: SessionUser | null, isPending = false, error: { status?: number } | null = null) {
  const refetch = vi.fn()
  vi.mocked(authClient.useSession).mockReturnValue({
    data: user ? { user } : null,
    isPending,
    isRefetching: false,
    error,
    refetch,
  } as never)
  return refetch
}

// jsdom's window.location.assign isn't configurable, so vi.spyOn can't wrap
// it directly — swap the whole location object out for the duration of each
// test that needs to observe a navigation.
const originalLocation = window.location

function stubLocationAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { ...originalLocation, assign }, writable: true, configurable: true })
  return assign
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true })
})

describe('useMe', () => {
  it('throws when called outside <Shell>', () => {
    const { result } = renderHook(() => {
      try { return useMe() } catch (err) { return err }
    })
    expect(result.current).toBeInstanceOf(Error)
    expect((result.current as Error).message).toBe('useMe() called outside <Shell>')
  })

  it('returns the context value inside <Shell>', () => {
    const { result } = renderHook(() => useMe(), {
      wrapper: ({ children }) => <MeContext.Provider value={ME}>{children}</MeContext.Provider>,
    })
    expect(result.current).toEqual(ME)
  })
})

describe('Shell — auth-guard states', () => {
  it('renders nothing while the session is pending', () => {
    mockSession(null, true)
    const { container } = render(<Shell page="inbox"><span>내용</span></Shell>)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing and redirects to /login when there is no session', () => {
    mockSession(null, false)
    const assign = stubLocationAssign()
    const { container } = render(<Shell page="inbox"><span>내용</span></Shell>)
    expect(container.firstChild).toBeNull()
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('renders the rail, topbar, and children once the session resolves', () => {
    mockSession(RAW_ME)
    render(<Shell page="inbox"><span>내용</span></Shell>)
    expect(screen.getByText('내용')).toBeTruthy()
    expect(screen.getByText('김한솔')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('shows a retry state (not /login) when the session check itself fails, and retry re-triggers the fetch', () => {
    const refetch = mockSession(null, false, { status: 500 })
    const assign = stubLocationAssign()
    render(<Shell page="inbox"><span>내용</span></Shell>)

    expect(screen.getByText('문제가 발생했습니다')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows connection-failure copy when the session check has no HTTP status at all (transport failure)', () => {
    mockSession(null, false, {})
    render(<Shell page="inbox"><span>내용</span></Shell>)
    expect(screen.getByText('서버에 연결할 수 없습니다')).toBeTruthy()
  })

  it('still redirects to /login on a 401 from the session check (better-auth already treats that as signed out)', () => {
    mockSession(null, false, { status: 401 })
    const assign = stubLocationAssign()
    render(<Shell page="inbox"><span>내용</span></Shell>)
    expect(assign).toHaveBeenCalledWith('/login')
  })
})

describe('Shell — Rail navigation', () => {
  it('marks the active page current, and hides 제품 관리/선원 for a non-admin', () => {
    mockSession(RAW_ME)
    render(<Shell page="board"><span /></Shell>)

    expect(screen.getByRole('link', { name: /선적 대기 보드/ })).toHaveProperty('ariaCurrent', 'page')
    expect(screen.getByRole('link', { name: /입항 대기/ })).not.toHaveProperty('ariaCurrent', 'page')
    expect(screen.queryByRole('link', { name: /제품 관리/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /선원/ })).toBeNull()
  })

  it('shows 제품 관리 for an admin, current only while actually on that page', () => {
    mockSession(RAW_ADMIN)
    render(<Shell page="products"><span /></Shell>)
    expect(screen.getByRole('link', { name: /제품 관리/ })).toHaveProperty('ariaCurrent', 'page')
  })

  it('renders 제품 관리 without aria-current when an admin is on a different page', () => {
    mockSession(RAW_ADMIN)
    render(<Shell page="board"><span /></Shell>)
    expect(screen.getByRole('link', { name: /제품 관리/ })).not.toHaveProperty('ariaCurrent', 'page')
  })

  // T9: 선원 (crew roster) is admin-only like 제품 관리, added to the same
  // rail block.
  it('shows 선원 for an admin, current only while actually on that page', () => {
    mockSession(RAW_ADMIN)
    render(<Shell page="crew"><span /></Shell>)
    expect(screen.getByRole('link', { name: /선원/ })).toHaveProperty('ariaCurrent', 'page')
  })

  it('renders 선원 without aria-current when an admin is on a different page', () => {
    mockSession(RAW_ADMIN)
    render(<Shell page="board"><span /></Shell>)
    expect(screen.getByRole('link', { name: /선원/ })).not.toHaveProperty('ariaCurrent', 'page')
  })

  it('renders no page title in the topbar for a page outside the nav (e.g. issue detail)', () => {
    mockSession(RAW_ME)
    render(<Shell page={null}><span>상세</span></Shell>)
    expect(screen.getByText('상세')).toBeTruthy()
    expect(document.querySelector('.topbar__title')).toBeNull()
  })
})

describe('Shell — ThemeToggle', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-theme') })

  it('mirrors the pre-set data-theme, toggles it, and persists to localStorage', () => {
    document.documentElement.dataset.theme = 'dark'
    mockSession(RAW_ME)
    render(<Shell page="inbox"><span /></Shell>)

    const toggle = screen.getByRole('button', { name: '밝은 테마' })
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('rudder-theme')).toBe('light')
    expect(screen.getByRole('button', { name: '어두운 테마' })).toBeTruthy()
  })

  it('still flips the DOM theme when localStorage.setItem throws', () => {
    mockSession(RAW_ME)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<Shell page="inbox"><span /></Shell>)

    const toggle = screen.getByRole('button', { name: '어두운 테마' })
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
    setItemSpy.mockRestore()
  })
})

describe('Shell — LogoutButton', () => {
  it('navigates to /login on a successful logout', async () => {
    vi.mocked(authClient.signOut).mockResolvedValue({ data: null, error: null } as never)
    mockSession(RAW_ME)
    const assign = stubLocationAssign()
    render(<Shell page="inbox"><span /></Shell>)

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(authClient.signOut).toHaveBeenCalled()
  })

  it('shows a retry hint and does not navigate when the server rejects the sign-out', async () => {
    // The realistic shape: better-auth's client resolves { data, error } on
    // an HTTP-level failure, it does not reject.
    vi.mocked(authClient.signOut).mockResolvedValue({ data: null, error: { message: 'INTERNAL_SERVER_ERROR' } } as never)
    mockSession(RAW_ME)
    const assign = stubLocationAssign()
    render(<Shell page="inbox"><span /></Shell>)

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByText('로그아웃하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '로그아웃' })).toHaveProperty('disabled', false)
  })

  it('shows a retry hint and does not navigate on a network-level rejection', async () => {
    vi.mocked(authClient.signOut).mockRejectedValue(new Error('network down'))
    mockSession(RAW_ME)
    const assign = stubLocationAssign()
    render(<Shell page="inbox"><span /></Shell>)

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByText('로그아웃하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('useTopbarActions', () => {
  it('registers the node into the topbar while mounted, and clears it on unmount', () => {
    mockSession(RAW_ME)

    function PageAction() {
      useTopbarActions(<button type="button">새 이슈</button>)
      return null
    }

    const { rerender } = render(<Shell page="inbox"><PageAction /></Shell>)
    expect(screen.getByRole('button', { name: '새 이슈' })).toBeTruthy()

    rerender(<Shell page="inbox"><span /></Shell>)
    expect(screen.queryByRole('button', { name: '새 이슈' })).toBeNull()
  })
})
