# PRD — Tyche Issue Tracker

Date: 2026-07-30
Status: Approved draft (PO interview 2026-07-30)
Owner: Hansol Kim (Product Owner)

## 1. Overview / Problem

Requests and improvement items for internal tools (<internal-dashboard>, <slack-bot-repo>,
lpa, partslink, etc.) arrive via Slack or verbally and get lost. There is no
grooming/prioritization process, requesters cannot see progress, and there is no
quarterly roadmap. Off-the-shelf trackers (Jira, Linear, etc.) do not match the
team's workflow and are too heavy for a small internal team.

We build a lightweight, workflow-fit issue tracker for internal use only.

**Product name: Rudder** (배의 키 — the rudder is the attribute of the goddess
Tyche, and the tool steers what the team does next). UI copy uses a nautical
harbor metaphor (issues as cargo moving through a port) for warmth and
memorability — see §7 for the binding naming rules.

## 2. Goals & Success Metrics

| Goal | Metric (first quarter after launch) |
|------|-------------------------------------|
| Every request recorded in one system | 100% of new requests become issues; 0 lost-in-Slack incidents |
| Explicit grooming | Median Inbox dwell time (created → groomed) ≤ 7 days |
| Self-serve progress visibility | 100% of In Progress issues have assignee + milestone |
| Visible quarterly planning | Every active milestone has roadmap entries |

## 3. Users & Roles

Authentication: shared login with existing IT Portal accounts. Exact mechanism
(SSO redirect vs. credential check against the portal) is decided at the
implementation-planning stage.

| Role | Who | Permissions |
|------|-----|-------------|
| Admin | Dev team / PO | Everything: grooming, priority/status/milestone decisions, roadmap and product management |
| User | All members incl. non-dev requesters | Create/view issues, comment, attach files, track own requests |
| AI Agent | <slack-bot-repo> and other services | Create/read issues via API token (service principal, separate from human roles) |

## 4. Core Workflow

```
Inbox (new) → Grooming → Backlog (priority-ordered) → In Progress → Done
                 └→ Rejected / On Hold (reason required)
```

- **Intake**: three equivalent paths create the same issue — web form, Slack
  (message/command), AI Agent (API).
- **Grooming** (Admin): assign priority label (P0/P1/P2) and decide
  accept / reject / hold. Backlog order is adjusted manually via drag & drop.
- **Roadmap**: issues are assigned to quarter/month milestones (e.g. `2026 Q3`);
  each milestone shows a progress bar.

## 5. Functional Requirements

**Issue fields**: title, description, type (bug / feature / improvement),
product, priority (P0/P1/P2), status, requester, assignee, milestone,
created/updated timestamps.

**Issue capabilities**:
- Comment thread (requester ↔ developer communication record)
- File/image attachments (screenshots)
- Automatic history of status/priority changes (who, when, what)
- Issue relations: duplicate / relates / blocks

**Views**:
- Inbox view — grooming queue
- Backlog board — kanban by status, drag ordering within backlog, product filter
- Roadmap view — issues grouped by milestone with progress bars
- My Requests view — requesters track their own issues

**Product management**: Admin registers/manages products; every issue belongs
to a product.

## 6. Integrations (all through the REST API — architecture A)

Single core service exposes a REST API; every client (web UI included) uses it.

| Client | Capability |
|--------|-----------|
| Web UI | Full functionality |
| <slack-bot-repo> | Create issues from Slack messages/commands; send notifications for new issues and status changes |
| AI Agent | Create/read issues via API token (e.g. the bot detects a requirement in conversation and files it automatically) |

Slack notifications: channel notification on new issue; requester notification
on status change of their issue.

## 7. Non-functional Requirements

- **Lightweight first**: ~10 internal users; low concurrency/scale needs.
  Minimal operational burden matters more than performance.
- **UI language**: Korean.
- **Naming & tone (metaphor B — harbor/rudder)**: nautical metaphor is used
  in the product name, status labels, empty states, and illustrations —
  never at the cost of usability. Binding rules:
  - Status labels pair the nautical Korean term with the standard term so
    nobody has to guess: 입항 대기(Inbox) · 선적 대기(Backlog) ·
    항해 중(In Progress) · 배송 완료(Done) · 반송(Rejected) · 정박(On Hold).
    Grooming action = 통관.
  - Code-level enum values stay standard English
    (`inbox/backlog/in_progress/done/rejected/on_hold`).
  - **"로드맵" and "마일스톤" keep their standard names** — the nautical
    항로(course)/항차(voyage) imagery may be used as roadmap *graphics* only,
    never as replacement terminology.
  - Priorities stay plain P0/P1/P2.
  - The future AI bot persona (§10) is named 도선사 (harbor pilot).
- **Design**: the design system is delegated to Claude via the
  `frontend-design` skill — see Appendix A for the delegation prompt.
- **Tech stack**: intentionally not fixed in this PRD; decided at the
  implementation-planning stage. Reuse of existing Tyche GCP infrastructure
  stays on the table.

## 8. Non-goals

- Sprints, story points, burndown charts, or other agile ceremony features
- Time tracking, external customer exposure, fine-grained per-field permissions
- Git commit/PR integration (revisit later)

## 9. Release Scope

Single release ("all at once"): issue tracker (web + API) + Slack
intake/notifications + AI Agent API + roadmap.

## 10. Future Direction (Out of Scope): AI-Augmented Decision Support

The long-term vision is an AI bot that actively participates in decisions
inside the tool — augmenting users, not just filing issues: e.g. duplicate
detection at intake, suggested priority during grooming, grooming briefs,
roadmap risk summaries. **None of this ships in this release**, but the
architecture must not close the door. Guardrails binding on this release:

1. **API-first parity** (already architecture A): every action a human can
   take in the UI is a named API operation. No UI-only business logic —
   a future agent can then do anything a human can.
2. **Actor attribution everywhere**: every mutation (status change, comment,
   priority set) records its actor, and actors can be humans *or* service
   principals (AI Agent). The history model from §5 must carry this from
   day one.
3. **Machine-readable context**: issue history, comments, relations, and
   grooming decisions (incl. reject/hold reasons) are queryable via the API,
   so future AI features need data, not schema changes.
4. **Suggestion ≠ action**: when AI decision support arrives, it lands as
   suggestions a human confirms (e.g. proposed priority with provenance),
   not silent writes. Nothing to build now — but do not design domain
   fields in a way that makes "who proposed this and was it confirmed"
   impossible to attach later.

---

## Appendix A — Design-System Delegation Prompt for Claude

Use the prompt below verbatim when delegating the design-system work.
Invoke the `frontend-design:frontend-design` skill first, then provide:

```
You are designing the design system for "Rudder" (러더), an internal issue
tracker / backlog / roadmap tool for a small Korean team (~10 people:
developers plus non-developer requesters). Use the frontend-design skill.

Brand metaphor (use it, but never at the cost of usability):
- Rudder = the ship's rudder, attribute of Tyche, goddess of fortune —
  the company is Tyche Technology, a cross-border auto-parts trading team.
- The UI speaks a light nautical harbor metaphor: issues are cargo moving
  through a port. Status labels pair nautical Korean with the standard
  term: 입항 대기(Inbox), 선적 대기(Backlog), 항해 중(In Progress),
  배송 완료(Done), 반송(Rejected), 정박(On Hold); grooming = 통관.
- "로드맵" and "마일스톤" keep their standard names. Nautical course/voyage
  (항로/항차) imagery may appear as roadmap GRAPHICS only (e.g. a dotted
  course line connecting milestone "ports", a small ship marking progress).
- Humor lives in empty states and micro-copy (e.g. empty inbox:
  "입항 대기 중인 화물이 없습니다. 오늘 바다는 잔잔하네요 ⚓"), never in
  data labels or actions.
- Priorities stay plain P0/P1/P2.

Product context:
- Internal-only tool. Korean UI text throughout.
- Core screens: Inbox (grooming queue), Backlog kanban board with drag
  ordering, Roadmap (milestones with progress bars), My Requests, and an
  Issue detail page with comment thread, attachments, change history, and
  issue relations.
- Issue metadata that must be visually distinct at a glance: status
  (Inbox / Backlog / In Progress / Done / Rejected / On Hold), priority
  (P0 / P1 / P2), type (bug / feature / improvement), product, milestone.

Design goals:
- Calm, information-dense, and fast to scan — a working tool, not a
  marketing site. Non-developers must find it approachable: clear labels,
  no jargon-only iconography.
- Distinctive but restrained: avoid the generic template look; give it a
  point of view (typography and accent color carry the identity).
- Light and dark themes from day one.
- Accessibility: WCAG AA contrast; color is never the only signal for
  status/priority (pair with text or shape).

Deliverables:
1. Design tokens: color palette (including semantic colors for the six
   statuses and three priorities), type scale, spacing, radii, elevation.
2. Component specs: status badge, priority label, issue card, kanban
   column, milestone progress bar, comment thread, form inputs, buttons,
   filter chips, empty states.
3. One representative screen per core view showing the system in use.

Constraints: web app, desktop-first with reasonable tablet behavior;
Korean text rendering (choose a typeface that handles Hangul well).
```

---

## Next Step

After PO review of this document, create the implementation plan
(superpowers writing-plans), which decides the tech stack, auth mechanism,
data model, and delivery order.
