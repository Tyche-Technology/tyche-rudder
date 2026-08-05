'use client'

// No shell (rail/topbar) — this is the one screen a signed-out visitor sees.
import { useEffect, useState, type FormEvent } from 'react'
import { authClient } from '@/lib/auth-client'

function RudderMark() {
  return (
    <svg className="brand__mark px" width="22" height="24" viewBox="0 0 11 12" aria-hidden="true">
      <g fill="currentColor">
        <rect x="2" y="0" width="2" height="12" />
        <rect x="4" y="3" width="1" height="6" />
        <rect x="5" y="4" width="1" height="5" />
        <rect x="6" y="5" width="1" height="4" />
        <rect x="7" y="6" width="1" height="3" />
        <rect x="8" y="7" width="1" height="2" />
      </g>
    </svg>
  )
}

// Never differentiate an unknown email from a wrong password in copy —
// either would leak which accounts exist.
const GENERIC_ERROR = '이메일 또는 비밀번호가 올바르지 않습니다'

// `signup_disabled` (the disableSignUp gate, better-auth's own code) is the
// one case where "check your invitation" is correct guidance. Everything
// else — an expired OAuth state, an account-linking conflict — gets a
// single honest generic message instead of being misattributed to "not
// invited".
function googleCallbackMessage(code: string): string | null {
  if (code === 'signup_disabled') return '구글 로그인에 실패했습니다. 초대된 계정인지 확인해 주세요.'
  // The user clicked Cancel on Google's consent screen — a deliberate
  // choice, not a failure. Showing an error here would scold them for
  // something they meant to do.
  if (code === 'access_denied') return null
  return '구글 로그인에 실패했습니다. 다시 시도해 주세요.'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  // The initial POST that starts the OAuth flow failing outright (provider
  // not configured, 500, rate limit) — distinct from googleCallbackError
  // below, which comes from a full page load back from Google's own
  // callback, not from this button's own request.
  const [googleSubmitError, setGoogleSubmitError] = useState(false)
  // Google's OAuth callback redirects the whole browser back here — a full
  // page load, not a client-side error state, so it's read once on mount
  // from the URL rather than passed through any handler here.
  const [googleCallbackError, setGoogleCallbackError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // authError=google is OUR OWN marker, a key distinct from better-auth's
    // `error` — so its callback handler's own error=<code> append (see
    // errorCallbackURL below) never collides with it, and `error`'s value is
    // always the real code, read directly. The marker also gates out an
    // unrelated ?error=... a stale link or bookmark might carry.
    if (params.get('authError') !== 'google') return
    const code = params.get('error')
    if (code) setGoogleCallbackError(googleCallbackMessage(code))
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      // better-auth's client resolves { data, error } on an HTTP-level
      // failure (wrong password, unknown email) — it does not reject.
      // Only a transport failure (network down) actually throws here.
      const { error: signInError } = await authClient.signIn.email({ email, password })
      if (signInError) {
        setError(GENERIC_ERROR)
        setPending(false)
        return
      }
    } catch {
      setError(GENERIC_ERROR)
      setPending(false)
      return
    }
    // Full navigation, not router.push: the shell reads identity from
    // authClient.useSession() on mount, so it must actually remount to pick
    // up the new session (same reasoning as the logout button in shell.tsx).
    window.location.assign('/inbox')
  }

  async function handleGoogle() {
    setGooglePending(true)
    setGoogleSubmitError(false)
    try {
      // Mirrors handleSubmit above: better-auth's client resolves
      // { data, error } on an HTTP-level failure (no google provider
      // configured, a 500, a rate limit) — it does not reject. Only a
      // transport failure (network down) throws here. A successful call
      // never falls through to either branch below: better-auth's redirect
      // fetch plugin sends the browser to Google directly on a
      // {url, redirect} response, before this promise even settles.
      const { error: socialError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/inbox',
        errorCallbackURL: '/login?authError=google',
      })
      if (socialError) {
        setGoogleSubmitError(true)
        setGooglePending(false)
        return
      }
    } catch {
      setGoogleSubmitError(true)
      setGooglePending(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-6)' }}>
      <div className="panel" style={{ width: '100%', maxWidth: '26rem' }}>
        <div className="panel__body stack">
          <div className="inline">
            <RudderMark />
            <span className="display">RUDDER</span>
          </div>
          <h1 className="h-panel">순항 준비</h1>
          {googleCallbackError ? <p className="hint">{googleCallbackError}</p> : null}
          <button className="btn" type="button" onClick={handleGoogle} disabled={googlePending}>Google로 로그인</button>
          {googleSubmitError ? <p className="hint">구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.</p> : null}
          <div className="inline" style={{ gap: 'var(--s-3)' }}>
            <div className="divider" style={{ flex: 1 }} />
            <span className="faint" style={{ fontSize: 'var(--t-12)' }}>또는</span>
            <div className="divider" style={{ flex: 1 }} />
          </div>
          <form className="stack" onSubmit={handleSubmit}>
            <div className="field">
              <label className="label" htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                className="input"
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="hint">{error}</p> : null}
            <button className="btn btn--primary" type="submit" disabled={pending}>로그인</button>
          </form>
        </div>
      </div>
    </main>
  )
}
