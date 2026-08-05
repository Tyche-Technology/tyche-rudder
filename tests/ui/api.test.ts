import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from '@/ui/api'

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns data on a { ok: true } envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { id: 1, title: '제목' } }),
    }))
    await expect(api('/api/v1/issues/1')).resolves.toEqual({ id: 1, title: '제목' })
  })

  it('sends a content-type header merged with caller init', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await api('/api/v1/issues', { method: 'POST', body: '{}' })
    // objectContaining, not an exact shape: api() also attaches a timeout
    // signal (see below), and this case is about the header merge only.
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/issues', expect.objectContaining({
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }))
  })

  // A request that never settles would leave every `pending`-gated control
  // disabled forever — worst in the three dialogs, where 취소 is disabled and
  // Esc is prevented while pending, i.e. a modal with no keyboard escape.
  // A FormData body (attachment upload) must NOT get 'content-type:
  // application/json' — the browser sets its own multipart boundary, and
  // forcing json here would corrupt the upload.
  it('omits the json content-type when the body is FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const form = new FormData()
    await api('/api/v1/issues/1/attachments', { method: 'POST', body: form })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({})
  })

  it('attaches an abort signal so a hung request cannot pin the UI', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await api('/api/v1/issues')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('lets a caller-supplied signal win over the default timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: null }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await api('/api/v1/issues', { signal: controller.signal })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  it('throws ApiError with the server message and status on a { ok: false } envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ ok: false, error: '규칙 위반입니다' }),
    }))
    await expect(api('/api/v1/issues/1')).rejects.toThrow('규칙 위반입니다')
    await expect(api('/api/v1/issues/1')).rejects.toMatchObject({ status: 422 })
  })

  it('carries the issues array from a failed envelope onto ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false, error: '입력값이 올바르지 않습니다', issues: [{ path: 'title', message: '문자열이어야 합니다' }],
      }),
    }))
    await expect(api('/api/v1/issues')).rejects.toMatchObject({
      status: 400,
      issues: [{ path: 'title', message: '문자열이어야 합니다' }],
    })
  })

  it('leaves issues undefined when the failed envelope has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ ok: false, error: '규칙 위반입니다' }),
    }))
    await expect(api('/api/v1/issues')).rejects.toMatchObject({ status: 422, issues: undefined })
  })

  it('throws ApiError with a fallback message when the body is not valid JSON', async () => {
    // status 400, not 5xx: the 5xx generic-message case below has its own
    // test, and would otherwise mask what this test is actually checking.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => { throw new SyntaxError('Unexpected token') },
    }))
    await expect(api('/api/v1/issues/1')).rejects.toThrow('요청에 실패했습니다')
    await expect(api('/api/v1/issues/1')).rejects.toMatchObject({ status: 400 })
  })

  it('throws ApiError(0, ...) when fetch itself rejects (offline, DNS failure, aborted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('/api/v1/issues/1')).rejects.toThrow('서버에 연결할 수 없습니다')
    await expect(api('/api/v1/issues/1')).rejects.toMatchObject({ status: 0 })
  })

  it('throws a fallback ApiError when a 2xx body claims ok:true but has no data key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }))
    await expect(api('/api/v1/issues/1')).rejects.toThrow('요청에 실패했습니다')
  })

  it('suppresses the response body message on a 5xx and uses a generic one instead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error: 'upstream stack trace: /var/www/secret.rb:42' }),
    }))
    // Equality, not just toThrow(substring): proves the leaked text is
    // fully replaced, not merely that the generic text also happens to appear.
    await expect(api('/api/v1/issues/1')).rejects.toMatchObject({
      status: 502,
      message: '서버 오류가 발생했습니다',
    })
  })

  it('redirects to /login on a 401 when not already there', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign, pathname: '/inbox' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: '로그인이 필요합니다' }),
    }))
    await expect(api('/api/v1/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('does not redirect on a 401 when already on /login', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign, pathname: '/login' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: '로그인이 필요합니다' }),
    }))
    await expect(api('/api/v1/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(assign).not.toHaveBeenCalled()
  })
})
