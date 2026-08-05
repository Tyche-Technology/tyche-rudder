'use client'

// The frame every other view renders inside (rail, topbar, theme toggle,
// identity context). Also the one auth guard the app needs: authClient's
// DB-backed session — blank while pending, /login when there's genuinely no
// session, and a retry state (not /login) when the session check itself
// fails — see the comment inside Shell for why that distinction matters.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import type { ApiUser } from './types'
import { BrandMark } from './sprites'
import { Avatar } from './bits'

// null = no matching nav item (e.g. a route outside the five nav pages,
// such as Task 7's /issues/[id]) — no aria-current is correct there, a
// guessed one is not.
export type ShellPage = 'inbox' | 'board' | 'roadmap' | 'requests' | 'products' | 'crew' | null

// design/shell.js NAV, minus counts (ponytail: add when a summary endpoint
// exists — see task brief) and minus the mockup-only "디자인 시스템" entry.
const NAV: Array<{ page: Exclude<ShellPage, null>; href: string; ko: string; en: string }> = [
  { page: 'inbox', href: '/inbox', ko: '입항 대기', en: 'Inbox' },
  { page: 'board', href: '/board', ko: '선적 대기 보드', en: 'Board' },
  { page: 'roadmap', href: '/roadmap', ko: '로드맵', en: 'Roadmap' },
  { page: 'requests', href: '/requests', ko: '내 요청', en: 'Mine' },
]

const PAGE_TITLE: Record<Exclude<ShellPage, null>, { ko: string; en: string }> = {
  inbox: { ko: '입항 대기', en: 'inbox' },
  board: { ko: '선적 대기 보드', en: 'board' },
  roadmap: { ko: '로드맵', en: 'roadmap' },
  requests: { ko: '내 요청', en: 'my requests' },
  products: { ko: '제품 관리', en: 'products' },
  crew: { ko: '선원 명부', en: 'crew' },
}

export const MeContext = createContext<ApiUser | null>(null)

// Shell only ever renders `children` once `me` has loaded, so a null context
// here means this was called outside <Shell> — a programmer error, not a
// runtime state to handle gracefully.
export function useMe(): ApiUser {
  const me = useContext(MeContext)
  if (!me) throw new Error('useMe() called outside <Shell>')
  return me
}

// Topbar action slot (e.g. Inbox's '새 이슈', Task 9's '마일스톤 추가') — see
// useTopbarActions below for the registration contract.
const SetTopbarActionsContext = createContext<(node: ReactNode) => void>(() => {})

// Hands Topbar a page-specific button without threading a prop through the
// shared (app) layout, which only forwards `children` to <Shell>. Registers
// `node` once, on mount — not on every render, and not reactively. A node
// whose content depends on props/state (a callback closing over a value
// that later changes, say) silently freezes at whatever it captured on the
// first render; nothing re-registers it when that value changes. Every
// current caller (NewIssueButton) is self-contained with no per-render
// props, so this holds today. A future caller that needs live content must
// add `node` to the deps array below and accept the extra re-registers —
// don't assume this hook tracks it automatically.
export function useTopbarActions(node: ReactNode): void {
  const setActions = useContext(SetTopbarActionsContext)
  useEffect(() => {
    setActions(node)
    return () => setActions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function ThemeToggle() {
  // The root layout's inline script already set data-theme before first
  // paint (design doc §10); mirroring it into state only after mount avoids
  // a server/client hydration mismatch on the button label.
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    // A blocked/throwing localStorage (Safari private mode, site data
    // disabled) must not stop setTheme below — otherwise the DOM flips but
    // the button label doesn't, and every later click reads stale state and
    // throws again. Persistence failing degrades to "works this session,
    // not remembered," never "control disagrees with the DOM."
    try {
      localStorage.setItem('rudder-theme', next)
    } catch {
      // ignore — see above
    }
    setTheme(next)
  }

  return (
    <button className="btn btn--ghost btn--sm" type="button" onClick={toggle}>
      {theme === 'dark' ? '밝은 테마' : '어두운 테마'}
    </button>
  )
}

// The mockup's rail foot has only the theme toggle and the identity row —
// the design forgot to let anyone leave. authClient.signOut() (better-auth's
// POST /api/auth/sign-out) is the only thing that ever calls it from the UI.
function LogoutButton() {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function logout() {
    if (pending) return
    setPending(true)
    setFailed(false)
    // Do NOT leave on failure, in either shape it can take: better-auth's
    // client resolves { data, error } on an HTTP-level failure and only
    // throws on a genuine transport failure — both are treated the same.
    // The session cookie is cleared by the *response*, so if the request
    // never landed (or the server rejected it) the cookie is still there
    // and still valid — showing /login while the browser is authenticated
    // is a worse lie than staying put.
    try {
      const { error } = await authClient.signOut()
      if (error) {
        setFailed(true)
        setPending(false)
        return
      }
    } catch {
      setFailed(true)
      setPending(false)
      return
    }
    // Full navigation, not router.push: Shell derives `me` from
    // authClient.useSession(), so a client-side push would keep rendering
    // the logged-out user's name until the session store settles.
    window.location.assign('/login')
  }

  return (
    <>
      <button className="btn btn--ghost btn--sm" type="button" onClick={logout} disabled={pending}>
        {pending ? '로그아웃 중…' : '로그아웃'}
      </button>
      {failed ? <span className="hint">로그아웃하지 못했습니다. 다시 시도해주세요.</span> : null}
    </>
  )
}

function Rail({ page, me }: { page: ShellPage; me: ApiUser }) {
  return (
    <nav className="rail" aria-label="주 메뉴">
      <Link className="brand" href="/inbox">
        <BrandMark />
        <span>
          <span className="brand__name">RUDDER</span><br />
          <span className="brand__sub">tyche · issues</span>
        </span>
      </Link>
      <div className="nav">
        {NAV.map((n) => (
          <Link key={n.page} className="nav__item" href={n.href} aria-current={n.page === page ? 'page' : undefined}>
            <span className="nav__label">{n.ko}</span>
            <span className="nav__en">{n.en}</span>
          </Link>
        ))}
        {/* Products/crew admin are admin-only server-side (requireAdmin on
            POST/PATCH /products and every admin mutation crew makes goes
            through better-auth's own admin-only endpoints); hiding the nav
            entry for everyone else keeps a non-admin from finding their way
            to a page whose body is just a 권한이 없습니다 dead end. */}
        {me.role === 'admin' ? (
          <>
            <div className="nav__group eyebrow">관리</div>
            <Link className="nav__item" href="/products" aria-current={page === 'products' ? 'page' : undefined}>
              <span className="nav__label">제품 관리</span><span className="nav__en">Products</span>
            </Link>
            <Link className="nav__item" href="/crew" aria-current={page === 'crew' ? 'page' : undefined}>
              <span className="nav__label">선원</span><span className="nav__en">Crew</span>
            </Link>
          </>
        ) : null}
      </div>
      <div className="rail__foot">
        <ThemeToggle />
        <LogoutButton />
        <div className="who-row">
          <Avatar name={me.name} />
          <span>
            <span style={{ fontSize: 'var(--t-13)', fontWeight: 600 }}>{me.name}</span><br />
            <span className="mono faint">{me.role}</span>
          </span>
        </div>
      </div>
    </nav>
  )
}

function Topbar({ page, actions }: { page: ShellPage; actions: ReactNode }) {
  // null (a route with no nav item, e.g. issue detail) has no page-level
  // title to show here — that page owns its own heading instead of getting
  // a guessed one.
  const title = page ? PAGE_TITLE[page] : null
  return (
    <header className="topbar">
      {title ? (
        <div className="topbar__title">
          <h1 className="h-panel">{title.ko}</h1>
          <span className="eyebrow">{title.en}</span>
        </div>
      ) : null}
      <div className="topbar__spacer" />
      {actions}
    </header>
  )
}

export function Shell({ page, children }: { page: ShellPage; children: ReactNode }) {
  const { data: sessionData, isPending, error: sessionError, refetch } = authClient.useSession()
  const [actions, setActions] = useState<ReactNode>(null)

  if (isPending) return null
  if (!sessionData?.user) {
    // A session fetch that fails for a reason OTHER than "not authenticated"
    // must show a retry state, not bounce to /login — /login depends on the
    // same backend and can't work either, so a real outage would send users
    // into an infinite reload loop (project-owner ruling; this restores the
    // pre-better-auth shape). better-auth's own session atom already
    // collapses a 401 into "no session" for us (it nulls `data` on a 401
    // exactly like the no-cookie case) — only a *different* status, or no
    // status at all (a transport failure that never reached a server),
    // means the check itself broke rather than confirming "signed out".
    if (sessionError && sessionError.status !== 401) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <div className="empty">
            <span className="empty__title">
              {sessionError.status ? '문제가 발생했습니다' : '서버에 연결할 수 없습니다'}
            </span>
            <span className="empty__body">잠시 후 다시 시도해주세요.</span>
            <button className="btn btn--sm" type="button" onClick={() => refetch()}>다시 시도</button>
          </div>
        </div>
      )
    }
    // Nothing here is worth painting while the browser navigates away.
    window.location.assign('/login')
    return null
  }

  const user = sessionData.user
  const me: ApiUser = {
    id: Number(user.id),
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    banned: Boolean(user.banned),
    // Not part of any better-auth plugin's client-inferred type (it's our
    // own additionalField, only known server-side) — read it defensively.
    slackUserId: (user as { slackUserId?: string | null }).slackUserId ?? null,
  }

  return (
    <div className="app">
      <Rail page={page} me={me} />
      <div className="main">
        <Topbar page={page} actions={actions} />
        <div className="view">
          <MeContext.Provider value={me}>
            <SetTopbarActionsContext.Provider value={setActions}>
              {children}
            </SetTopbarActionsContext.Provider>
          </MeContext.Provider>
        </div>
      </div>
    </div>
  )
}
