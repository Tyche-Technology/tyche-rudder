'use client'

// No shell — like /login, this is a screen a signed-out (or freshly-linked)
// visitor sees. Same brand/panel layout and copy register as
// src/app/login/page.tsx; two ways in, mirroring login's Google + password:
//   - Google: better-auth links the OAuth identity to the pre-created
//     invitee account implicitly, by email match against better-auth.ts's
//     accountLinking.trustedProviders — this page then POSTs
//     /invites/consume to burn the invite once a session exists for that
//     exact user.
//   - Password: POST /invites/accept sets the password, signs in, and burns
//     the invite server-side in one call.
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { api, useApi, ApiError } from '@/ui/api'

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

type InviteStatus = { email: string; name: string; status: 'pending' | 'used' | 'expired' }

// Shown for a used/expired invite from the initial status check, AND when a
// password submit comes back 410 mid-flow (the invite was live when the page
// loaded but got burned — by this same submit racing another, or elsewhere
// — before the request landed): both are "this link is dead," same message.
const GONE_MESSAGE = '이 초대 링크는 더 이상 사용할 수 없습니다. 관리자에게 새 초대 링크를 요청해 주세요.'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// authError=google is our own marker key, distinct from better-auth's own
// `error` — its callback handler always APPENDS its own error=<code> after
// whatever query errorCallbackURL already carries (redirectOnError never
// replaces an existing key), so the real round trip is
// /invite/{token}?authError=google&error=<code>. Because the marker never
// collides with `error`, `error` is read directly with its real value — no
// ordering games. signup_disabled (the uninvited-account gate) is the one
// code where "wrong Google account" is correct guidance. access_denied
// means the user clicked Cancel — a deliberate choice, not a failure, so it
// renders nothing. Everything else gets one honest generic message instead
// of being misattributed to "wrong account". Same authError-marker
// convention as login/page.tsx (Task 7); not a shared helper, since the two
// pages' message vocabularies differ.
function googleCallbackMessage(code: string, email: string): string | null {
  if (code === 'signup_disabled') return `구글 로그인에 실패했습니다. 초대된 이메일(${email})의 구글 계정으로 시도해 주세요.`
  if (code === 'access_denied') return null
  return '구글 로그인에 실패했습니다. 다시 시도해 주세요.'
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const { data, error, loading } = useApi<InviteStatus>(`/api/v1/invites/${token}`)
  const { data: sessionData, isPending: sessionPending } = authClient.useSession()

  const [gone, setGone] = useState(false)
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Password path's own version of the 200/ok:false dead end: the invite is
  // already spent by this point, so the form must not stay up offering a
  // retry that would only 410 into "ask the admin" — a lie for a user whose
  // account already works.
  const [signinFailed, setSigninFailed] = useState(false)
  const [consuming, setConsuming] = useState(false)
  // Terminal gate on the auto-consume effect: without this, a failure would
  // reset `consuming` and re-trigger the same effect immediately (nothing
  // else in its guard changed), hammering the endpoint forever with no
  // feedback. One manual retry (the button below) is the only way back in.
  const [consumeFailed, setConsumeFailed] = useState(false)
  const [googleErrorCode, setGoogleErrorCode] = useState<string | null>(null)
  const [googlePending, setGooglePending] = useState(false)
  const [googleSubmitError, setGoogleSubmitError] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('authError') !== 'google') return
    const code = params.get('error')
    if (code) setGoogleErrorCode(code)
  }, [])

  // Both sides normalized before comparing: invite emails are stored
  // trimmed+lowercased (invites.ts), and this exact mismatch class has
  // recurred before in this project.
  const sessionEmail = !sessionPending && sessionData?.user?.email ? normalizeEmail(sessionData.user.email) : null
  const inviteEmail = data ? normalizeEmail(data.email) : null
  // An already-authenticated visitor whose session doesn't match this
  // invite — e.g. a colleague forwarded the link by mistake. Neither the
  // Google button nor the password form check this on their own, so the UI
  // must say so plainly before either one silently switches their session.
  const sessionMismatch = !!sessionEmail && !!inviteEmail && sessionEmail !== inviteEmail

  // Google path bookkeeping: once a session exists for the exact invitee
  // (email match — the account was pre-created at invite time, so email is
  // the only link between "who signed in" and "which invite this is"),
  // POST consume to burn the invite, then enter the app.
  useEffect(() => {
    if (sessionPending || loading || !data || consuming || consumeFailed) return
    if (!sessionEmail || sessionMismatch) return
    setConsuming(true)
    api('/api/v1/invites/consume', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => window.location.assign('/inbox'))
      .catch(() => {
        setConsuming(false)
        setConsumeFailed(true)
      })
  }, [sessionPending, loading, data, consuming, consumeFailed, sessionEmail, sessionMismatch, token])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setFormError(null)
    try {
      await api('/api/v1/invites/accept', { method: 'POST', body: JSON.stringify({ token, password }) })
    } catch (err) {
      setPending(false)
      // 410 means the invite died between page-load and this submit — no
      // form-level retry can fix that, so drop into the same dead-link state
      // as an initially-used/expired invite.
      if (err instanceof ApiError && err.status === 410) { setGone(true); return }
      // 200 with ok:false: the password WAS set and the invite already
      // burned server-side (accept/route.ts's transaction commits before
      // the signInEmail attempt), only the follow-up sign-in failed. A
      // retry of this same form would now 410 — terminal state instead, so
      // the guidance (and a real link to act on it) replaces the form.
      if (err instanceof ApiError && err.status === 200) {
        setFormError(err.message)
        setSigninFailed(true)
        return
      }
      setFormError(err instanceof ApiError ? err.message : '요청에 실패했습니다')
      return
    }
    // Full navigation: the shell reads identity from authClient.useSession()
    // on mount and must remount to pick it up (same as login/page.tsx).
    window.location.assign('/inbox')
  }

  async function handleGoogle() {
    setGooglePending(true)
    setGoogleSubmitError(false)
    try {
      // better-auth's client resolves { data, error } on an HTTP-level
      // failure (no google provider configured, a 500, a rate limit) — it
      // does not reject. Only a transport failure (network down) throws
      // here. A successful call never falls through to either branch below:
      // better-auth's redirect fetch plugin sends the browser to Google
      // directly on a {url, redirect} response, before this promise settles.
      const { error: socialError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: `/invite/${token}`,
        errorCallbackURL: `/invite/${token}?authError=google`,
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

  const isGone = gone || data?.status === 'used' || data?.status === 'expired'
  const googleCallbackErrorMessage = data && googleErrorCode ? googleCallbackMessage(googleErrorCode, data.email) : null

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-6)' }}>
      <div className="panel" style={{ width: '100%', maxWidth: '26rem' }}>
        <div className="panel__body stack">
          <div className="inline">
            <RudderMark />
            <span className="display">RUDDER</span>
          </div>
          {loading ? null : error ? (
            <p className="hint">{error.message}</p>
          ) : isGone ? (
            <p className="hint">{GONE_MESSAGE}</p>
          ) : signinFailed ? (
            <>
              <p className="hint">{formError}</p>
              <a className="btn btn--primary" href="/login">로그인 페이지로 이동</a>
            </>
          ) : consumeFailed ? (
            <>
              <p className="hint">초대 확인에 실패했습니다. 다시 시도해 주세요.</p>
              <button className="btn" type="button" onClick={() => setConsumeFailed(false)}>다시 시도</button>
            </>
          ) : data ? (
            <>
              <h1 className="h-panel">{data.name}님, Rudder에 오신 것을 환영합니다</h1>
              <p className="faint">{data.email}</p>
              {sessionMismatch ? (
                <p className="hint hint--danger">
                  {`현재 ${sessionData?.user?.email ?? ''} 계정으로 로그인되어 있습니다. 계속 진행하면 이 세션이 초대된 계정(${data.email})으로 전환됩니다.`}
                </p>
              ) : null}
              {googleCallbackErrorMessage ? <p className="hint">{googleCallbackErrorMessage}</p> : null}
              <button className="btn" type="button" onClick={handleGoogle} disabled={googlePending}>Google로 로그인</button>
              {googleSubmitError ? <p className="hint">구글 로그인을 시작하지 못했습니다. 다시 시도해 주세요.</p> : null}
              <div className="inline" style={{ gap: 'var(--s-3)' }}>
                <div className="divider" style={{ flex: 1 }} />
                <span className="faint" style={{ fontSize: 'var(--t-12)' }}>또는</span>
                <div className="divider" style={{ flex: 1 }} />
              </div>
              <form className="stack" onSubmit={handleSubmit}>
                <div className="field">
                  <label className="label" htmlFor="password">비밀번호</label>
                  <input
                    id="password"
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {formError ? <p className="hint">{formError}</p> : null}
                <button className="btn btn--primary" type="submit" disabled={pending}>비밀번호 설정</button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
