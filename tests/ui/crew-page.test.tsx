// @vitest-environment jsdom
// T9: the crew roster page — admin creates invites, copies the one-time
// link, changes roles, bans/unbans. Drives the real module against a mocked
// GET /api/v1/users, a mocked POST /api/v1/invites, and a mocked
// authClient.admin (setRole/banUser/unbanUser) — the same { data, error }
// resolves-not-throws shape Task 7 established from the installed
// @better-fetch/fetch source (login-page.test.tsx, shell.test.tsx).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { ApiUser } from '@/ui/types'

// jsdom has no <dialog> support (no showModal/close) — same shim every
// native <dialog> component here needs under jsdom (milestone-dialog.test.tsx,
// new-issue.test.tsx, relations-panel.test.tsx).
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }

const ADMIN: ApiUser = { id: 1, email: 'admin@tyche.test', name: '관리자', role: 'admin', banned: false, slackUserId: null }
const NON_ADMIN: ApiUser = { id: 1, email: 'u@tyche.test', name: '일반유저', role: 'user', banned: false, slackUserId: null }

let currentMe: ApiUser = ADMIN

vi.mock('@/ui/shell', () => ({
  useMe: () => currentMe,
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    admin: { setRole: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn() },
  },
}))

import { authClient } from '@/lib/auth-client'
import CrewPage from '@/app/(app)/crew/page'

const USERS = [
  { id: 2, email: 'kim@tyche.test', name: '김선원', role: 'user' as const, banned: false, slackUserId: 'U123' },
  { id: 3, email: 'lee@tyche.test', name: '이선장', role: 'admin' as const, banned: true, slackUserId: null },
]

const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => ({ ok: true, data }) })
const fail = (error: string, status: number, issues?: Array<{ path: string; message: string }>) => ({
  ok: false, status, json: async () => ({ ok: false, error, issues }),
})

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  currentMe = ADMIN
})

describe('CrewPage — non-admin', () => {
  it('renders the empty-state instead of the roster', () => {
    currentMe = NON_ADMIN
    // useUsers() still runs unconditionally before the role check (rules of
    // hooks — same precedent as products/page.tsx), so GET /users is not
    // asserted against here; only that the guard wins the render.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) })))

    render(<CrewPage />)
    expect(screen.getByText('권한이 없습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '초대' })).toBeNull()
  })
})

describe('CrewPage — roster table', () => {
  // GET /api/v1/users omits banned/slackUserId for non-admins, so a stale
  // admin session (demoted in another tab) can render rows without them.
  // Absent must not read as "not suspended" / "not mapped".
  it('shows — rather than 활성/슬랙 미연동 when the API omitted the privileged fields', async () => {
    const reduced = [{ id: 4, email: 'park@tyche.test', name: '박갑판', role: 'user' as const }]
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(reduced)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    const row = (await screen.findByText('박갑판')).closest('.row') as HTMLElement
    expect(within(row).queryByText('활성')).toBeNull()
    expect(within(row).queryByText('정지됨')).toBeNull()
    expect(within(row).queryByText('슬랙 미연동')).toBeNull()
    expect(within(row).getAllByText('—').length).toBe(2)
  })

  it('renders name, email, role, 상태, slackUserId for every user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    expect(screen.getByText('kim@tyche.test')).toBeTruthy()
    expect(screen.getByText('U123')).toBeTruthy()
    expect(screen.getByLabelText('김선원 역할')).toHaveProperty('value', 'user')
    expect(screen.getAllByText('활성').length).toBeGreaterThan(0)

    expect(screen.getByText('이선장')).toBeTruthy()
    expect(screen.getByText('lee@tyche.test')).toBeTruthy()
    expect(screen.getByText('슬랙 미연동')).toBeTruthy()
    expect(screen.getByLabelText('이선장 역할')).toHaveProperty('value', 'admin')
    expect(screen.getByText('정지됨')).toBeTruthy()
  })
})

describe('CrewPage — 초대 (create invite)', () => {
  it('POSTs email/name/role, then shows the one-time link with a working 복사 button', async () => {
    const writeText = stubClipboard()
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/users' && method === 'GET') return ok(USERS)
      if (path === '/api/v1/invites' && method === 'POST') {
        const body = JSON.parse(init!.body as string)
        expect(body).toEqual({ email: 'new@tyche.test', name: '새 선원', role: 'admin' })
        return ok({ inviteUrl: 'https://rudder.test/invite/abc123', userId: 9, expiresAt: '2026-08-11T00:00:00.000Z' }, 201)
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')

    fireEvent.click(screen.getByRole('button', { name: '초대' }))
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@tyche.test' } })
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새 선원' } })
    fireEvent.change(screen.getByLabelText('역할'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: '초대 생성' }))

    const linkInput = await screen.findByLabelText('초대 링크')
    expect(linkInput).toHaveProperty('value', 'https://rudder.test/invite/abc123')
    expect(screen.getByText('이 링크는 다시 표시되지 않습니다 · 7일 후 만료')).toBeTruthy()

    // Whose link this is must be on screen — otherwise a reissue race
    // between two rows can hand the wrong person's link to the wrong person
    // with nothing visible to catch it.
    const dialog = screen.getByLabelText('초대 결과')
    expect(within(dialog).getByText(/새 선원/)).toBeTruthy()
    expect(within(dialog).getByText(/new@tyche\.test/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://rudder.test/invite/abc123'))
    expect(screen.getByRole('button', { name: '복사됨' })).toBeTruthy()
  })

  it('shows the 409 duplicate-email message from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/users' && method === 'GET') return ok(USERS)
      if (path === '/api/v1/invites' && method === 'POST') return fail('이미 등록된 이메일입니다', 409)
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    fireEvent.click(screen.getByRole('button', { name: '초대' }))
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'kim@tyche.test' } })
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '김선원' } })
    fireEvent.click(screen.getByRole('button', { name: '초대 생성' }))

    expect(await screen.findByText('이미 등록된 이메일입니다')).toBeTruthy()
    expect(screen.queryByLabelText('초대 링크')).toBeNull()
  })
})

describe('CrewPage — 재발급 (reissue)', () => {
  it("POSTs the row's own email/name/role with no form step, and shows the new link", async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/users' && method === 'GET') return ok(USERS)
      if (path === '/api/v1/invites' && method === 'POST') {
        const body = JSON.parse(init!.body as string)
        expect(body).toEqual({ email: 'kim@tyche.test', name: '김선원', role: 'user' })
        return ok({ inviteUrl: 'https://rudder.test/invite/reissued', userId: 2, expiresAt: '2026-08-11T00:00:00.000Z' }, 201)
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '재발급' }))

    const linkInput = await screen.findByLabelText('초대 링크')
    expect(linkInput).toHaveProperty('value', 'https://rudder.test/invite/reissued')

    const dialog = screen.getByLabelText('초대 결과')
    expect(within(dialog).getByText(/김선원/)).toBeTruthy()
    expect(within(dialog).getByText(/kim@tyche\.test/)).toBeTruthy()
  })
})

describe('CrewPage — role select', () => {
  it('calls authClient.admin.setRole with the coerced-to-string userId and new role', async () => {
    vi.mocked(authClient.admin.setRole).mockResolvedValue({ data: { user: {} }, error: null } as never)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    fireEvent.change(screen.getByLabelText('김선원 역할'), { target: { value: 'admin' } })

    await waitFor(() => expect(authClient.admin.setRole).toHaveBeenCalledWith({ userId: '2', role: 'admin' }))
  })

  it('shows a generic error and does not crash when the server rejects the role change', async () => {
    vi.mocked(authClient.admin.setRole).mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } } as never)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    fireEvent.change(screen.getByLabelText('김선원 역할'), { target: { value: 'admin' } })

    expect(await screen.findByText('역할을 변경하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
  })
})

describe('CrewPage — self-row protection', () => {
  it("disables the acting admin's own role select, shows why, and blocks setRole even if the disabled attribute is bypassed", async () => {
    const rosterWithSelf = [ADMIN, ...USERS]
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(rosterWithSelf)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const select = screen.getByLabelText('관리자 역할') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(screen.getByText('본인 역할은 여기서 변경할 수 없습니다')).toBeTruthy()

    // Bypass the UI-level disable (devtools / stale render) to prove the
    // handler itself refuses a self role-change, not just the <select>
    // attribute — a disabled-only guard is not evidence the write is blocked.
    select.disabled = false
    fireEvent.change(select, { target: { value: 'user' } })
    expect(authClient.admin.setRole).not.toHaveBeenCalled()
  })

  it("disables the acting admin's own 정지 trigger", async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok([ADMIN])
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    const adminRow = (await screen.findByLabelText('관리자 역할')).closest('.row') as HTMLElement
    const banButton = within(adminRow).getByRole('button', { name: '정지' }) as HTMLButtonElement
    expect(banButton.disabled).toBe(true)
  })
})

describe('CrewPage — invite dialog identifies the recipient (재발급 race safety)', () => {
  it('shows a stray Esc is a no-op while the one-time link is displayed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/users' && method === 'GET') return ok(USERS)
      if (path === '/api/v1/invites' && method === 'POST') {
        return ok({ inviteUrl: 'https://rudder.test/invite/esc-test', userId: 9, expiresAt: '2026-08-11T00:00:00.000Z' }, 201)
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '재발급' }))
    await screen.findByLabelText('초대 링크')

    const dialog = screen.getByLabelText('초대 결과') as HTMLDialogElement
    const cancelEvent = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancelEvent)
    expect(cancelEvent.defaultPrevented).toBe(true)
  })

  it('닫기 clears the invite link from state so a stale token cannot linger in a hidden dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/users' && method === 'GET') return ok(USERS)
      if (path === '/api/v1/invites' && method === 'POST') {
        return ok({ inviteUrl: 'https://rudder.test/invite/close-test', userId: 9, expiresAt: '2026-08-11T00:00:00.000Z' }, 201)
      }
      throw new Error(`unrouted ${method} ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    fireEvent.click(screen.getByRole('button', { name: '초대' }))
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'new@tyche.test' } })
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새 선원' } })
    fireEvent.click(screen.getByRole('button', { name: '초대 생성' }))
    await screen.findByLabelText('초대 링크')

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(document.getElementById('invite-link')).toBeNull()
  })
})

describe('CrewPage — ban/unban', () => {
  it('requires confirmation before calling banUser, and does nothing on 취소', async () => {
    vi.mocked(authClient.admin.banUser).mockResolvedValue({ data: { user: {} }, error: null } as never)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement

    fireEvent.click(within(kimRow).getByRole('button', { name: '정지' }))
    expect(within(kimRow).getByText('세션이 즉시 종료되며 로그인할 수 없게 됩니다')).toBeTruthy()

    fireEvent.click(within(kimRow).getByRole('button', { name: '취소' }))
    expect(authClient.admin.banUser).not.toHaveBeenCalled()
    expect(within(kimRow).queryByText('세션이 즉시 종료되며 로그인할 수 없게 됩니다')).toBeNull()

    fireEvent.click(within(kimRow).getByRole('button', { name: '정지' }))
    fireEvent.click(within(kimRow).getByRole('button', { name: '정지' }))
    await waitFor(() => expect(authClient.admin.banUser).toHaveBeenCalledWith({ userId: '2' }))
  })

  it('calls unbanUser directly (no confirmation) for an already-banned row', async () => {
    vi.mocked(authClient.admin.unbanUser).mockResolvedValue({ data: { user: {} }, error: null } as never)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('이선장')
    const leeRow = screen.getByText('이선장').closest('.row') as HTMLElement
    fireEvent.click(within(leeRow).getByRole('button', { name: '정지 해제' }))

    await waitFor(() => expect(authClient.admin.unbanUser).toHaveBeenCalledWith({ userId: '3' }))
  })

  it('shows a generic error when the server rejects the ban', async () => {
    vi.mocked(authClient.admin.banUser).mockResolvedValue({ data: null, error: { message: 'YOU_CANNOT_BAN_YOURSELF' } } as never)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '정지' }))
    fireEvent.click(within(kimRow).getByRole('button', { name: '정지' }))

    expect(await screen.findByText('계정을 정지하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
  })
})

describe('CrewPage — 슬랙 ID 편집', () => {
  it('수정 opens an input pre-filled with the current slackUserId, and 취소 discards without calling the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))

    const input = within(kimRow).getByLabelText('김선원 슬랙 ID') as HTMLInputElement
    expect(input.value).toBe('U123')

    fireEvent.change(input, { target: { value: 'garbage' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '취소' }))

    expect(within(kimRow).queryByLabelText('김선원 슬랙 ID')).toBeNull()
    expect(within(kimRow).getByText('U123')).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('trims whitespace and saves a valid id through the narrow users API', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/users') return ok(USERS)
      if (path === '/api/v1/users/3' && init?.method === 'PATCH') return ok({ id: 3, slackUserId: 'U01ABCDEFGH' })
      throw new Error(`unrouted GET ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CrewPage />)
    await screen.findByText('이선장')
    const leeRow = screen.getByText('이선장').closest('.row') as HTMLElement
    fireEvent.click(within(leeRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(leeRow).getByLabelText('이선장 슬랙 ID'), { target: { value: '  U01ABCDEFGH  ' } })
    fireEvent.click(within(leeRow).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/users/3', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ slackUserId: 'U01ABCDEFGH' }),
    })))
    await waitFor(() => expect(within(leeRow).queryByLabelText('이선장 슬랙 ID')).toBeNull())
  })

  it('an empty input saves null (clears the mapping)', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/users') return ok(USERS)
      if (path === '/api/v1/users/2' && init?.method === 'PATCH') return ok({ id: 2, slackUserId: null })
      throw new Error(`unrouted GET ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(kimRow).getByLabelText('김선원 슬랙 ID'), { target: { value: '   ' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/users/2', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ slackUserId: null }),
    })))
  })

  it('rejects a pasted @mention with a format error and does not call the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(kimRow).getByLabelText('김선원 슬랙 ID'), { target: { value: '@hansol' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    expect(await within(kimRow).findByText(/슬랙 사용자 ID 형식이 아닙니다/)).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    // Still editing — the bad value must stay visible to fix, not vanish.
    expect(within(kimRow).getByLabelText('김선원 슬랙 ID')).toBeTruthy()
  })

  it('rejects a lowercase id (exact-match compare against Slack IDs is case-sensitive)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(kimRow).getByLabelText('김선원 슬랙 ID'), { target: { value: 'u01abcdefgh' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    expect(await within(kimRow).findByText(/슬랙 사용자 ID 형식이 아닙니다/)).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('saving the unchanged value closes editing without calling the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === '/api/v1/users') return ok(USERS)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    expect(within(kimRow).queryByLabelText('김선원 슬랙 ID')).toBeNull()
  })

  it('shows a generic error and stays in edit mode when the server rejects the update', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/users') return ok(USERS)
      if (path === '/api/v1/users/2' && init?.method === 'PATCH') return fail('권한이 없습니다', 403)
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(kimRow).getByLabelText('김선원 슬랙 ID'), { target: { value: 'U01ABCDEFGH' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    expect(await within(kimRow).findByText('슬랙 ID를 저장하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
    expect(within(kimRow).getByLabelText('김선원 슬랙 ID')).toBeTruthy()
  })

  it('a rejecting promise (transport failure) is caught and shows the same generic error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/users') return ok(USERS)
      if (path === '/api/v1/users/2' && init?.method === 'PATCH') throw new Error('network down')
      throw new Error(`unrouted GET ${path}`)
    }))

    render(<CrewPage />)
    await screen.findByText('김선원')
    const kimRow = screen.getByText('김선원').closest('.row') as HTMLElement
    fireEvent.click(within(kimRow).getByRole('button', { name: '수정' }))
    fireEvent.change(within(kimRow).getByLabelText('김선원 슬랙 ID'), { target: { value: 'U01ABCDEFGH' } })
    fireEvent.click(within(kimRow).getByRole('button', { name: '저장' }))

    expect(await within(kimRow).findByText('슬랙 ID를 저장하지 못했습니다. 다시 시도해주세요.')).toBeTruthy()
    expect(within(kimRow).getByLabelText('김선원 슬랙 ID')).toBeTruthy()
  })
})
