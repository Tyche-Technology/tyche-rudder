'use client'

// Admin-only crew roster: create invites, copy the one-time link, change
// roles, ban/unban. There is deliberately no delete control — offboarding
// is ban-only, because invites.invited_by is a non-nullable FK and issue/
// comment history must survive a departed teammate.
import { useRef, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { useMe } from '@/ui/shell'
import { useUsers } from '@/ui/catalog-data'
import { EmptyState } from '@/ui/bits'
import { InviteDialog, type InviteDialogHandle } from '@/ui/invite-dialog'
import { isSlackUserId } from '@/lib/slack-user-id'
import { api } from '@/ui/api'
import type { ApiUser } from '@/ui/types'

// better-auth's client resolves { data, error } on an HTTP-level failure
// (Task 7's finding from @better-fetch/fetch source: throw is never set) —
// only a transport failure actually rejects. Both are shown the same
// generic Korean line; better-auth's `error.message` is an English/
// SCREAMING_CASE code, not user-facing copy.
const ROLE_ERROR = '역할을 변경하지 못했습니다. 다시 시도해주세요.'
const BAN_ERROR = '계정을 정지하지 못했습니다. 다시 시도해주세요.'
const UNBAN_ERROR = '정지를 해제하지 못했습니다. 다시 시도해주세요.'
const SLACK_SAVE_ERROR = '슬랙 ID를 저장하지 못했습니다. 다시 시도해주세요.'
const SLACK_FORMAT_ERROR = '슬랙 사용자 ID 형식이 아닙니다. U 또는 W로 시작하는 대문자·숫자 조합을 입력하세요.'
// The present consumer is src/lib/slack.ts, which passes this value straight
// to chat.postMessage's `channel` — so a non-user-id shape publishes a user's
// issue activity into a conversation. That module applies the same check;
// this one is the early, friendly half. (tyche-slack-bot is expected to match
// it with exact string equality, but that integration is unmerged — PR #34 —
// so treat it as an intended contract, not observed behaviour.)

export default function CrewPage() {
  const me = useMe()
  const { users, error, refetch } = useUsers()
  const inviteRef = useRef<InviteDialogHandle>(null)

  if (me.role !== 'admin') {
    return <EmptyState title="권한이 없습니다" body="선원 명부는 관리자만 사용할 수 있습니다." />
  }

  if (error) {
    return (
      <>
        <div className="empty">
          <span className="empty__title">불러오지 못했습니다</span>
          <span className="empty__body">{error.message}</span>
          <button className="btn btn--sm" type="button" onClick={refetch}>다시 시도</button>
        </div>
        <InviteDialog ref={inviteRef} onIssued={refetch} />
      </>
    )
  }
  // useUsers() has no separate loading flag — data stays null until the
  // fetch resolves either way, and error (checked above) already claimed
  // the failure branch, so null here means "still in flight".
  if (users === null) return null

  return (
    <>
      <div className="view__head">
        <h2 className="h-view">선원 명부</h2>
        <span className="mono muted push">{users.length}명</span>
        <button className="btn btn--primary btn--sm" type="button" onClick={() => inviteRef.current?.openCreate()}>초대</button>
      </div>
      <p className="view__lede">
        선원 명부는 유저 관리 화면입니다. 초대로 계정을 만들고, 역할을 바꾸고, 필요하면
        접근을 정지합니다. 계정을 완전히 삭제할 수는 없습니다 — 이슈·댓글 이력이 그
        사람 없이도 남아 있어야 하기 때문입니다.
      </p>

      <div className="panel">
        <div className="rows">
          {users.map((user) => (
            <CrewRow
              key={user.id}
              user={user}
              me={me}
              onChanged={refetch}
              onReissue={(u) => inviteRef.current?.reissue(u)}
            />
          ))}
        </div>
      </div>

      <InviteDialog ref={inviteRef} onIssued={refetch} />
    </>
  )
}

function CrewRow({
  user, me, onChanged, onReissue,
}: {
  user: ApiUser
  me: ApiUser
  onChanged: () => void
  onReissue: (user: ApiUser) => void
}) {
  // better-auth's setRole has no self/last-admin check of its own
  // (node_modules/better-auth/dist/plugins/admin/routes.mjs) — a sole admin
  // who demotes themselves has no in-app way back (scripts/seed-admin.ts's
  // bootstrap guard refuses once any admin exists). This UI guard is Layer
  // 1: it stops the realistic accident (a misclick on your own row). It
  // does not stop a direct API call to /api/auth/admin/set-role, which is
  // Layer 2's job (the seed-admin recovery path), not this component's.
  const isSelf = user.id === me.id
  const [rolePending, setRolePending] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)
  const [banPending, setBanPending] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)
  const [confirmingBan, setConfirmingBan] = useState(false)
  const [editingSlack, setEditingSlack] = useState(false)
  const [slackValue, setSlackValue] = useState('')
  const [slackPending, setSlackPending] = useState(false)
  const [slackError, setSlackError] = useState<string | null>(null)
  const anyPending = rolePending || banPending || slackPending

  async function changeRole(role: 'admin' | 'user') {
    // Guards the handler itself, not just the <select>'s disabled attribute
    // below — the attribute is a UI courtesy that a stale render or
    // devtools could bypass; this is the real barrier.
    if (isSelf || role === user.role || rolePending) return
    setRolePending(true)
    setRoleError(null)
    try {
      const { error } = await authClient.admin.setRole({ userId: String(user.id), role })
      if (error) { setRoleError(ROLE_ERROR); return }
      onChanged()
    } catch {
      setRoleError(ROLE_ERROR)
    } finally {
      setRolePending(false)
    }
  }

  async function ban() {
    if (banPending) return
    setBanPending(true)
    setBanError(null)
    try {
      const { error } = await authClient.admin.banUser({ userId: String(user.id) })
      if (error) { setBanError(BAN_ERROR); return }
      setConfirmingBan(false)
      onChanged()
    } catch {
      setBanError(BAN_ERROR)
    } finally {
      setBanPending(false)
    }
  }

  async function unban() {
    if (banPending) return
    setBanPending(true)
    setBanError(null)
    try {
      const { error } = await authClient.admin.unbanUser({ userId: String(user.id) })
      if (error) { setBanError(UNBAN_ERROR); return }
      onChanged()
    } catch {
      setBanError(UNBAN_ERROR)
    } finally {
      setBanPending(false)
    }
  }

  function startSlackEdit() {
    if (anyPending) return
    setSlackValue(user.slackUserId ?? '')
    setSlackError(null)
    setEditingSlack(true)
  }

  function cancelSlackEdit() {
    setEditingSlack(false)
    setSlackError(null)
  }

  async function saveSlack() {
    if (slackPending) return
    const trimmed = slackValue.trim()
    // Empty input is the clear path (constraint: clearing must stay
    // possible) — everything else must match the bot's exact-string-equality
    // shape or get rejected here, before it ever reaches the row.
    const next = trimmed === '' ? null : trimmed
    // No-op check runs before format validation on purpose: re-saving an
    // untouched value (including a legacy one that predates this format
    // rule) must not get blocked by a check that only matters when the
    // value is actually changing.
    if (next === (user.slackUserId ?? null)) {
      setEditingSlack(false)
      setSlackError(null)
      return
    }
    if (next !== null && !isSlackUserId(next)) {
      setSlackError(SLACK_FORMAT_ERROR)
      return
    }
    setSlackPending(true)
    setSlackError(null)
    try {
      await api(`/api/v1/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ slackUserId: next }) })
      setEditingSlack(false)
      onChanged()
    } catch {
      setSlackError(SLACK_SAVE_ERROR)
    } finally {
      setSlackPending(false)
    }
  }

  return (
    <div className="row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto auto auto', alignItems: 'start' }}>
      <div className="stack stack--sm" style={{ minWidth: 0 }}>
        <span className="row__title">{user.name}</span>
        <span className="hint mono">{user.email}</span>
        {editingSlack ? (
          <div className="inline inline--tight">
            <input
              className="input mono"
              style={{ maxWidth: 180 }}
              aria-label={`${user.name} 슬랙 ID`}
              maxLength={65}
              value={slackValue}
              disabled={slackPending}
              onChange={(e) => setSlackValue(e.target.value)}
            />
            <button className="btn btn--sm" type="button" disabled={slackPending} onClick={saveSlack}>{slackPending ? '저장 중…' : '저장'}</button>
            <button className="btn btn--ghost btn--sm" type="button" disabled={slackPending} onClick={cancelSlackEdit}>취소</button>
          </div>
        ) : (
          <div className="inline inline--tight">
            <span className="mono faint">{user.slackUserId === undefined ? '—' : user.slackUserId ?? '슬랙 미연동'}</span>
            <button className="btn btn--ghost btn--sm" type="button" disabled={anyPending} onClick={startSlackEdit}>수정</button>
          </div>
        )}
        {slackError ? <span className="hint">{slackError}</span> : null}
        {roleError ? <span className="hint">{roleError}</span> : null}
        {banError ? <span className="hint">{banError}</span> : null}
      </div>
      <div className="select-wrap">
        <select
          className="select"
          aria-label={`${user.name} 역할`}
          value={user.role}
          disabled={isSelf || anyPending}
          onChange={(e) => changeRole(e.target.value === 'admin' ? 'admin' : 'user')}
        >
          <option value="user">일반</option>
          <option value="admin">관리자</option>
        </select>
        {isSelf ? <span className="hint">본인 역할은 여기서 변경할 수 없습니다</span> : null}
      </div>
      {/* undefined ≠ false: the API omits banned for non-admins, so a stale
          admin session (demoted in another tab) would otherwise read every
          crew member as 활성. Say "unknown" rather than assert a state. */}
      <span className={user.banned ? 'mono' : 'mono faint'}>
        {user.banned === undefined ? '—' : user.banned ? '정지됨' : '활성'}
      </span>
      <button className="btn btn--sm" type="button" disabled={anyPending} onClick={() => onReissue(user)}>재발급</button>
      {confirmingBan ? (
        <div className="inline">
          <span className="hint">세션이 즉시 종료되며 로그인할 수 없게 됩니다</span>
          <button className="btn btn--ghost btn--sm" type="button" disabled={anyPending} onClick={() => setConfirmingBan(false)}>취소</button>
          <button className="btn btn--danger btn--sm" type="button" disabled={anyPending} onClick={ban}>정지</button>
        </div>
      ) : user.banned ? (
        <button className="btn btn--sm" type="button" disabled={anyPending} onClick={unban}>정지 해제</button>
      ) : (
        // Self-ban is already refused server-side (YOU_CANNOT_BAN_YOURSELF),
        // harmlessly — this just skips the friction of walking through the
        // confirm step only to get a generic rejection.
        <button className="btn btn--danger btn--sm" type="button" disabled={isSelf || anyPending} onClick={() => setConfirmingBan(true)}>정지</button>
      )}
    </div>
  )
}
