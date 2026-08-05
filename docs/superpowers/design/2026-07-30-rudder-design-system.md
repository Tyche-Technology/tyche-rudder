# Rudder — Design System (v0.1)

Date: 2026-07-30
Spec: `docs/superpowers/specs/2026-07-30-issue-tracker-design.md` (Appendix A prompt)
Artefacts: `design/rudder.css` (tokens + components), `design/index.html` (living
style guide), `design/01-inbox.html` … `design/05-issue.html` (one screen per core
view), `design/shell.js` (shared rail + theme toggle),
`design/contrast-check.mjs` (AA gate).

This document is binding on Phase 2 UI work. Where it and the mockups disagree,
the mockups are the source of truth for markup and `rudder.css` for values —
this file explains the *rules* the values encode.

---

## 0. Direction

**A clear morning underway.** Pale sky and open water are the ground; one warm
beacon amber is the only brand hue. Not the industrial container-yard read that
the first pass produced (rejected by the PO as too cold): this tool should feel
good to open, and reaching a destination should feel like something.

The harbour metaphor appears only where it does work, never as decoration:

| Metaphor | Where it lives | Job it does |
|---|---|---|
| International Code of Signals flags | status chips | colour + pattern + label = three signals, so status survives colour-blindness and greyscale |
| Waterline | milestone progress | a hull settling as cargo is loaded; 100% turns green because arrival is a result |
| Horizon timeline | roadmap hero | **position is time**: ports stand at milestone deadlines on a real date axis, the ship stands at today. The metaphor rides on the axis, never replaces it |
| Pixel graphics | every illustration | small, honest, memorable; a soft vector illustration would read as a marketing page |

Deliberately **not** used: navy-and-anchor nautical clichés, 항로/항차 as
terminology (spec §7 forbids it — graphics only), humour anywhere near a data
label or an action.

One idea was cut during the design pass: a three-segment "load gauge"
(▮▮▯) for priority. The text `P0` is already a non-colour signal, so the gauge
was decoration. Priority is text-first, and only P0 is chromatic.

---

## 1. Tokens

All tokens are CSS custom properties in `design/rudder.css`. Dark theme
overrides the same names under `:root[data-theme='dark']`, so **no component
knows which theme it is in**. Never hard-code a hex in a component, and never
use `#fff` on an inverted fill — `--ink` is near-white in dark theme, so
inverted text must be `var(--surface)`.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` / `--canvas-far` | `#eef4f7` / `#f8fbfc` | `#0a1620` / `#0d1d28` | app background (a soft vertical gradient) |
| `--surface` | `#ffffff` | `#10202a` | panels, cards, rail, topbar |
| `--sunken` | `#f2f7f9` | `#0c1922` | kanban wells, comment bodies, row hover |
| `--ink` | `#10242e` | `#e8f1f4` | primary text; also the primary button fill |
| `--ink-2` | `#2f4a57` | `#c3d5dc` | prose |
| `--muted` | `#405b68` | `#92aab5` | labels, meta, secondary UI |
| `--faint` | `#536e7b` | `#7b95a2` | 11–12px data, hints, eyebrows |
| `--hairline` / `--hairline-strong` | `#d7e3e8` / `#b9cbd3` | `#21323d` / `#334956` | borders; strong = interactive borders |
| `--accent` (Beacon) | `#e0921c` | `#f2ab3c` | brand mark, active nav bar, P0, drop indicator, one confirm button per screen |
| `--accent-ink` | `#9a6100` | `#f8c473` | accent as *text* on a light ground |
| `--on-accent` | `#1a1200` | `#17120a` | text on an accent fill |
| `--focus` | `#0e6f9e` | `#56b6e0` | focus ring — deliberately not the accent, so focus is never confused with brand emphasis |
| `--sky-1/2`, `--sea-1/2`, `--land` | see stylesheet | | **graphics only.** Never a UI surface |
| `--water`, `--water-fill`, `--water-crest` | `#0e9bb0` … | `#2ebccf` … | waterline + gauges |

Four text tiers is the maximum this palette supports; a fifth would not clear
AA on a tinted canvas. If you need more hierarchy, use size and weight.

### Status colours

Six statuses, each with a flag hue, a chip ground, and a chip text colour.
`--st-inbox-bg` is `transparent` on purpose (see §2).

`--st-inbox` `#6d8794` · `--st-backlog` `#1e5fa8` · `--st-progress` `#0e9bb0` ·
`--st-done` `#188a5e` · `--st-rejected` `#99513f` · `--st-hold` `#5b7183`

In Progress and Done are separated by **hue and chroma, not lightness**: live
work is bright cyan, finished work is a saturated green (not a muted one —
arrival is rewarded). Rejected is the only deliberately low-chroma status: it is
a dead end, and it must never compete with a vivid P0.

### Type

Three roles, all Hangul-capable:

| Role | Family | Why this one |
|---|---|---|
| Display (`--font-display`) | **Gothic A1** 700/800 | wide, open counters — carries air at 20–34px where a UI sans goes flat |
| Body / UI (`--font-body`) | **Pretendard Variable** 400–600 | the most reliable Hangul legibility at 12–14px in dense lists |
| Data (`--font-mono`) | **IBM Plex Mono** 400/500 | issue ids, timestamps, counts, `issue_events.field` values. Fixed width makes columns scannable |

Scale: `11 / 12 / 13 / 14 / 16 / 20 / 26 / 34`. Line heights: `1.28` tight
(headings), `1.4` UI, `1.65` prose — Hangul needs the extra prose leading.
Utilities: `.display .h-view .h-panel .h-card .eyebrow .mono .prose .id`.

### Space, radii, elevation

- Space: 4px base — `2 4 8 12 16 20 24 32 40 48` as `--s-05 … --s-12`.
- Radii: `--r-sm 4` (inputs, buttons, cards' inner bits), `--r-md 8` (cards),
  `--r-lg 12` (panels), `--r-pill` (status chips, type chips, filter chips,
  avatars, gauges).
- Elevation: `--e-1` resting, `--e-2` hover, `--e-3` **only** for a card being
  dragged (paired with `rotate(0.5deg)` — the one tactile flourish in the system).

---

## 2. Status = signal flags

Every status renders as `.chip.chip--<status>` containing `.flag.flag--<status>`
plus the Korean label plus `.chip__en` with the standard English term. Spec §7
requires the pairing; the flag pattern is what makes it accessible.

| Chip | Flag pattern | Enum | Meaning |
|---|---|---|---|
| 입항 대기 `Inbox` | dashed outline, **no fill** | `inbox` | before grooming; no priority yet |
| 선적 대기 `Backlog` | blue field, white rectangle (ICS "P", Blue Peter — about to sail) | `backlog` | groomed, waiting in order |
| 항해 중 `In Progress` | horizontal bands | `in_progress` | assignee working |
| 배송 완료 `Done` | diagonal stripe | `done` | complete; counts toward progress |
| 반송 `Rejected` | white cross | `rejected` | reason required; **excluded from progress denominators** |
| 정박 `On Hold` | quartered | `on_hold` | reason required; stays in the denominator (delayed, not cancelled) |

**Inbox has no colour, and that is the point.** Grooming (통관) is the act that
assigns colour. It makes the Inbox screen visually calm and the board visually
organised, and it teaches the workflow without a tooltip.

`.flag--pilot` (ICS "H", pilot aboard — pale/red halves) is **reserved for the
도선사 agent actor** and is not a status. It marks "the bot filed this on a
human's behalf" next to a requester name and on the `created` history row. The
pale half is `--sunken`, not white, because a white half vanishes on a white row.

Q (yellow, quarantine/clearance requested) is the flag that historically means
"I request free pratique" — i.e. customs clearance, which is exactly 통관. It is
referenced in the style guide but not drawn, because Inbox is colourless.

---

## 3. Priority and type

**Priority is text first.** `.ptag--p0` is an accent fill with `--on-accent`
text; `.ptag--p1` is outlined; `.ptag--p2` is muted text with no chrome. On a
kanban card, P0 also gets `border-left: 3px solid var(--accent)` (`.card--p0`).
Nothing else on the board is amber, so the eye finds P0 first — that is the
whole design.

**Type carries no colour.** `.ttag` is a neutral outlined pill with a mono
glyph: `▲` 버그, `＋` 기능, `↑` 개선. A third colour system on the same card
would destroy the P0 signal. Product and milestone are mono text, not swatches,
for the same reason.

---

## 4. Component rules

Anatomy lives in the mockups. These are the rules that are not visible in markup.

**Buttons.** Default action is `--ink` (`.btn--primary`). `.btn--accent` is
limited to **one per screen** and only for a decision that is awkward to undo
(통관, 항해 시작). `.btn--danger` for 반송. Action labels stay identical through
the whole flow: the button that says 통관 produces a history row that says 통관.

**Manifest row (`.row`).** The dense list line for Inbox and My Requests: id ·
title · type · product · actor/status · date · action. CSS grid with explicit
columns so ids and dates form real columns. Under 900px, type and date columns
are hidden, never wrapped.

**Issue card (`.card`).** Grip appears on hover only. `.drop` is the ordering
drop indicator (2px accent line with a dot). `.card--lifted` = `--e-3` +
0.5° rotation.

**Kanban column (`.col`).** Sunken well, `.col__head` carries the status chip
and a mono count. The Backlog column carries `.col__note` documenting the
keyboard path — see §7.

**Waterline (`.berth`).** `.berth__water` is an absolutely positioned child at
`z-index: -1` whose `height` is `--fill`. Add `.berth--live` for the current
milestone (a very slow crest drift) and `.berth--arrived` at 100% (the fill
turns `--st-done`). `.gauge` is the compact list variant; `.gauge--arrived` at
100%.

**Horizon timeline (`.horizon` + `.tl`).** Roadmap only. The PO's ruling, after
seeing an evenly-spaced one-port-per-quarter draft: *conveying when milestones
fall is more important than the metaphor, and one quarter can hold several
milestones.* The rules that encode that:

- **Position is time.** The track maps the visible date range linearly to
  2%–98% (`--x` per element). The range is min(start)–max(end) of visible
  milestones, rounded out to quarter boundaries.
- **The scale is quarters**: `.tl__tick` dashed verticals at quarter
  boundaries, `.tl__qlabel` at each band start. Quarters are the *scale*, not
  the data — a quarter holds however many milestone ports fall inside it.
- **Every port stands at its milestone's END date** (the deadline is the
  destination). The ship (`.tl__ship`) stands at **today**, floating slightly
  into the water, z-raised so it passes in front of nearby ports; its 오늘 tag
  hangs below in the sea band where nothing else lives.
- **Marker states follow the real aids-to-navigation hierarchy** — waypoints
  are small buoys; the ONE lighthouse stands at the **end of the visible
  route** (the latest planned milestone). Two drafts died before this rule,
  both on PO review: a lighthouse per milestone (cluttered — the lighthouse
  has power *because* it is singular), then "lighthouse = nearest future
  deadline" (dishonest — it jumped on its own as dates passed, and it lit an
  untouched future milestone while an overdue one was the team's actual
  focus). The rule now separates concepts: the lighthouse is a **place** claim
  ("the planned route ends here" — always true), and **time** urgency belongs
  to buoy lights. States: `--dest` (THE lighthouse, accent, blinking — at
  most one) · `--next` (nearest future deadline — a **lit buoy**, accent
  topmark blinking, `--muted` hull) · `--future` (unlit buoy, `--faint`) ·
  `--overdue` (red danger buoy + `D+n` — a hazard the ship sailed past) ·
  `--done` (green flag on the coast). Buoys take `--afloat` (hull dips below
  the waterline); land markers sit on it. Milestones sharing an end date share
  one port marker with stacked labels. **Visual height = informational
  weight**: buoys are low and quiet; only the lighthouse and the ship are
  tall.
- **Labels alternate two rows** (`.tl__cap--a/--b`, chronological order) so
  close-together deadlines cannot collide; row-B caps carry a thin leader down
  to their port. A cap at the track's right edge takes `.tl__cap--end`.
- Below 860px the track scrolls horizontally inside `.tl-scroll` rather than
  compressing.
- **Ports stand on land, ships float**: port sprites include a `--land` island;
  only the ship touches water.

**Comment thread (`.cmt`) / history (`.log`).** Comments are attributed on the
comment row; history rows show actor, human-readable change, and the raw
`issue_events.field` value in mono — see §8. Note that comments produce no
`issue_events` row (Phase 1 property), so "full history" is
`issue_events ∪ comments`, which is what `getIssueDetail` already returns.

**Empty states (`.empty`).** One shared illustration, `.px-sea` (three offset
rows of pixel blocks = calm water). Title states the fact, body states the next
action. Humour is allowed here and nowhere else.

**Stamp (`.stamp`).** A dashed, slightly rotated 반송 stamp shown beside a
rejection reason. The only intentionally playful element inside a data view,
justified because a closed request must be unmistakable.

---

## 5. Pixel graphic rules

1. Every illustration is drawn as `<rect>`s on an integer grid inside an SVG
   whose `viewBox` **is** the grid. Add `class="px"` (`shape-rendering:
   crispEdges`).
2. `width`/`height` must be an integer multiple of the viewBox, or pixels land
   on half-device-pixels and blur. Current sprites: ship `17×14 @4×`,
   lighthouse `15×16 @4×` (grouped `lh__light`/`lh__beam`/`lh__tower`; at most
   one instance on screen — see §4), channel buoy `11×9 @3×`, danger buoy
   `11×11 @3×`, visited-port flag `13×10 @3×`, sun `9×9 @4×`, crescent moon
   `9×9 @4×`, brand mark `11×12 @2×`.
3. Sprites take colour from `currentColor` and tokens (`--accent`, `--land`,
   `--st-done`) so one sprite serves both themes. **The exception is the sun.**
   Recolouring the same disc cool for dark theme was not enough — it still read
   as a pale sun — so `.horizon__sun--day` and `.horizon__sun--night` are two
   sprites (disc / crescent) swapped by `display` on the theme attribute. When a
   graphic's *meaning* changes with the theme, draw two sprites; when only its
   lightness changes, recolour one.
4. **UI chrome is never pixelated** — chips, buttons, inputs, tables stay
   vector-crisp. Density and legibility outrank the bit.
5. Motion: the ship bobs (5s), the beacon blinks (4s), the live waterline crest
   drifts (9s). Nothing else moves, and all of it stops under
   `prefers-reduced-motion`.

---

## 6. The five views

| View | Shape | Notes |
|---|---|---|
| **Inbox** (`01-inbox.html`) | manifest rows + inline grooming panel | The grooming panel is an expanded row, not a modal: priority segmented control (required), milestone, assignee, then 통관 / 반송 / 정박. Reason field is required for the latter two |
| **Backlog board** (`02-backlog.html`) | 4 columns — 선적 대기 / 항해 중 / 정박 / 배송 완료 | Rejected is filtered out by default with an explicit "반송 보기" escape. Product filter chips above. Drag ordering only inside 선적 대기 |
| **Roadmap** (`03-roadmap.html`) | horizon timeline + milestone panels grouped by quarter | Timeline: position = date, ship = today, the one lighthouse = end of route, lit buoy = nearest deadline, `D+n` overdue state. Panels group under quarter headings by **deadline quarter**, ordered by end date, so the list mirrors the axis — the multi-milestone-per-quarter case is first-class. Counts print `완료 8 / 집계 13` plus `반송 2 · 집계 제외`. Each panel footer shows "최종 수정 · 이름 · 날짜" — see §9 |
| **My Requests** (`04-my-requests.html`) | rows grouped 진행 중 / 종료 | A rejected row always renders its reason inline with the 반송 stamp. Copy explains what 입항 대기 means, for non-developers |
| **Issue detail** (`05-issue.html`) | 2-column split | Left: description, attachments, comment thread, composer. Right: meta, decision buttons, relations, history. Agent comments are **not** shown — Phase 1 forbids them (`comments/route.ts`), and the design must not imply a capability that returns 403 |

---

## 7. Accessibility floor

- **Colour is never the only signal.** Status = colour + flag pattern + label.
  Priority = text, with only P0 chromatic. Type = glyph + neutral.
- **Contrast.** Every text/ground pair used in the system is AA (≥4.5:1) in
  both themes. Measured by `node design/contrast-check.mjs`, which parses the
  tokens out of `rudder.css` (so it cannot go stale) and exits non-zero on a
  failure. Current worst pair: **4.54:1** (`faint` on `sky-1`, light).

| pair | light | dark |
|---|---|---|
| `ink / surface` | 15.98:1 | 14.52:1 |
| `ink-2 / surface` | 9.38:1 | 10.99:1 |
| `muted / surface` | 7.21:1 | 6.85:1 |
| `muted / canvas` | 6.49:1 | 7.52:1 |
| `faint / surface` | 5.41:1 | 5.28:1 |
| `faint / canvas` | 4.87:1 | 5.80:1 |
| `faint / sunken` | 5.01:1 | 5.66:1 |
| `faint / sky-1` | 4.54:1 | 5.15:1 |
| `ink / sky-1` (timeline names) | 13.41:1 | 14.16:1 |
| `muted / sea-1` (오늘 tag) | 5.60:1 | 6.00:1 |
| `st-rejected-fg / sky-1` (D+n label) | 7.46:1 | 7.90:1 |
| `accent-ink / surface` | 5.14:1 | 10.41:1 |
| `on-accent / accent` | 7.34:1 | 9.46:1 |
| `focus / surface` | 5.55:1 | 7.26:1 |
| `surface / ink` (primary button) | 15.98:1 | 14.52:1 |
| `st-inbox-fg / surface` | 7.22:1 | 8.42:1 |
| `st-backlog-fg / bg` | 8.05:1 | 9.08:1 |
| `st-progress-fg / bg` | 5.81:1 | 9.65:1 |
| `st-done-fg / bg` | 6.48:1 | 9.36:1 |
| `st-rejected-fg / bg` | 7.39:1 | 8.12:1 |
| `st-hold-fg / bg` | 7.64:1 | 9.16:1 |

  Two defects the measurement caught that review-by-eye did not: the dark-theme
  primary button was white-on-white (1.15:1) because it used `#fff` against
  `--ink`, and the original `--faint` was 3.08:1. Run the gate, do not eyeball it.
- **Focus.** `:focus-visible` gives a 2px `--focus` ring with 2px offset on
  every interactive element. `--focus` is a blue that is not the accent.
- **Drag has a keyboard equivalent.** Backlog reordering must work by focusing a
  card and pressing ⌥↑ / ⌥↓, hitting the same `POST /issues/{id}/reorder`
  endpoint. The board documents this in the column footer. Drag-only ordering is
  not shippable.
- **Motion.** `prefers-reduced-motion` kills every animation and transition.
- `color-scheme` is set per theme so native form controls and scrollbars follow.

---

## 8. Copy deck

Voice: plain, active, from the user's side of the screen. Sentence case. An
action keeps its name through the whole flow.

**Status labels** — always paired, never abbreviated to one language:
입항 대기(Inbox) · 선적 대기(Backlog) · 항해 중(In Progress) · 배송 완료(Done) ·
반송(Rejected) · 정박(On Hold). Grooming action = **통관**. Roadmap and
milestone keep their standard Korean names (로드맵, 마일스톤).

**History field labels.** `issue_events.field` is frozen snake_case (Phase 1
obligation). The UI maps it to Korean and keeps the raw value visible in mono so
the audit trail stays greppable:

| `field` | Korean |
|---|---|
| `created` | 등록 |
| `status` | 상태 |
| `priority` | 우선순위 |
| `reason` | 사유 |
| `title` | 제목 |
| `description` | 설명 |
| `type` | 유형 |
| `product_id` | 제품 |
| `assignee_id` | 담당자 |
| `milestone_id` | 마일스톤 |
| `sort_order` | 백로그 순서 |
| `relation_added` / `relation_removed` | 관계 추가 / 관계 해제 |

This table is the single place the mapping lives. Adding an event field means
adding a row here in the same change.

**Empty states.**
- Inbox: **입항 대기 중인 화물이 없습니다** / 오늘 바다는 잔잔하네요 ⚓ 새 요청이 들어오면 여기 먼저 도착합니다.
- Roadmap milestone: **이 분기 항로가 아직 비어 있습니다** / 마일스톤을 만들고 선적 대기 이슈를 배치하면 진척률이 여기 표시됩니다.
- Board column: (count 0) 이 열은 비어 있습니다.
- My Requests: **아직 보낸 요청이 없습니다** / 새 이슈로 첫 요청을 등록해 보세요.

**Rules for errors and hints.** State what happened and what to do; never
apologise, never be vague. Reject/hold hint: "반송·정박은 사유를 남겨야
저장됩니다." Roadmap counts hint: "진척률 분모는 반송된 이슈를 제외한
건수입니다." Do not put humour in a label, an action, or an error.

**Roadmap time copy.** Head: `다음 기한: <마일스톤 이름> · N일 남음` — 기한 is a
*time* concept and belongs to the lit buoy; 항구/등대 is a *place* concept and
belongs to the route's end. Do not mix them (an earlier `다음 항구:` head
collided with the lighthouse rule). Overdue label: `기한 MM-DD · D+n`, and the
panel hint names the way out: "남은 이슈를 옮기거나 기한을 조정하세요." Today
marker: just `오늘` (the reference date prints once, top-right).

---

## 9. What this design requires from the API (input to the Phase 2 UI plan)

The design was drawn against the Phase 1 API and deliberately surfaces the gaps
rather than hiding them. Each of these is a named Phase 2 task:

1. **Catalog attribution** (overview obligation 1, final review I5). The roadmap
   milestone panel prints "최종 수정 · 이름 · 날짜". `products` and `milestones`
   have no actor columns and no `updatedAt`, and `createProduct` /
   `createMilestone` / `updateMilestone` take no `Actor`. The design cannot
   render that line until the migration lands. This is the schema task.
2. **`GET /users`** (final review §10.1). Needed for the assignee picker in the
   grooming panel and issue detail. Does not exist.
3. **`PATCH /products`** (final review M9). `products.active` has no writer, but
   the 제품 관리 nav item and the product filter both imply one.
4. **Roadmap counts and dates** (final review I4). The design commits to
   `완료 / 집계 / 반송(제외)` as three separate numbers. Confirm the endpoint
   returns them separately rather than a `total` that silently includes
   rejections. The timeline additionally needs each milestone's **start and
   end dates** in the roadmap payload — port position, quarter grouping, the
   `D+n` overdue state, and "N일 남음" are all derived client-side from
   end date vs today.
5. **`sortOrder` on backlog exit** (final review I3) is what makes the board's
   drag order trustworthy; the UI has no way to compensate for it.
6. **Discriminated error `kind`** (final review I6). The UI needs to distinguish
   not-found from conflict from rule-violation to choose copy. Matching Korean
   prose from the API in the client would repeat the bug the review names.
7. **Reorder needs a keyboard path**, so `POST /issues/{id}/reorder` must be
   callable with an explicit target index, not only from a drag gesture.

Also inherited from Phase 1 and relevant to any delete affordance the UI adds:
existence pre-checks assume no deletion endpoints exist. Adding a delete
endpoint requires revisiting the checks in `respond.ts` and
`catalog.ts:updateMilestone`.

---

## 10. Bringing this into Next.js

- `design/rudder.css` is the real stylesheet, not a throwaway. Import it from
  `src/app/globals.css` (or replace that file with it) and delete the
  create-next-app leftovers (`page.module.css`, the template `page.tsx`).
- **Self-host the fonts.** The mockups pull Pretendard from jsDelivr and Gothic
  A1 / IBM Plex Mono from Google Fonts via `@import`, which is fine for a static
  prototype and wrong for the app: use `next/font/local` (or `next/font/google`
  for the two Google families) so there is no third-party request on every load
  and no layout shift.
- Theme: `data-theme` on `<html>`, persisted. Read it before first paint (an
  inline script or a cookie) or the app flashes light before switching.
- Components: `.chip`, `.flag`, `.ptag`, `.ttag`, `.card`, `.row`, `.berth`,
  `.gauge`, `.course` are plain classes with no JS. Wrap each in a small React
  component so the status→(label, flag class, English term) mapping exists once.
- `design/shell.js` is mockup-only scaffolding; the real rail is a React
  component. Do not port the `outerHTML` injection.
