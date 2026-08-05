# Rudder Phase 3 — kickoff prompt

Paste everything below the line into a fresh session started in
`~/orca/projects/tyche-rudder`.

---

Rudder(러더)는 Tyche 사내 이슈 트래커다. Phase 1(REST API)과 Phase 2(웹 UI)가
`master`에 머지·푸시돼 있다(`e3003e8`, 358 테스트, 커버리지 게이트 통과).
이제 **Phase 3 — 통합과 출시**를 진행한다.

## 먼저 읽을 것 (순서대로)

1. `docs/superpowers/specs/2026-07-30-issue-tracker-design.md` — PRD.
   **§7 네이밍 규칙과 §10 AI 가드레일은 구속력을 가진다.**
2. `docs/superpowers/plans/2026-07-30-rudder-overview.md` — 페이즈 개요.
   "Phase 1 outcome"과 "Phase 2 outcome" 두 섹션의 **이월 항목과
   "deliberately accepted" 목록이 이번 페이즈의 입력값**이다. 추측하지 말고
   거기 적힌 근거를 그대로 읽어라.
3. `README.md` — 아키텍처(A: UI는 `/api/v1/*`의 클라이언트), dev 서버 락 규칙,
   PGlite 함정, KST 날짜 규칙.
4. `docs/superpowers/design/2026-07-30-rudder-design-system.md` — 새 화면을
   만들 일이 생기면 이게 규격이다.

## Phase 3 범위

개요 표 기준: **첨부파일(GCS), 슬랙 알림, <slack-bot-repo> 인테이크,
Playwright E2E, Cloud Run 배포.** 여기에 아래 이월 항목이 더해진다.

Phase 3 계획 문서는 아직 없다(`2026-08-XX-rudder-phase3-launch.md`).
**계획부터 쓴다** — Phase 2가 "디자인 시스템 → 계획 → 구현" 순서를 지켜서
"목업과 맞나?"가 리뷰 시점에 답변 가능한 질문이 됐다. 같은 이유로 여기서는
**배포 대상 환경의 사실 확인 → 계획 → 구현** 순서를 지켜라.

## 반드시 다뤄야 할 이월 항목

개요의 "Obligations carried into Phase 3"가 정본이고, 요약하면:

1. **클라이언트 왕복 낙관적 잠금을 하나의 계약 결정으로.** 이슈 PATCH의
   expected-version, reorder CAS, 마일스톤 CAS를 **따로 고치지 마라** — 요청에
   필수 필드가 하나 늘어나는 API 계약 변경이고, 슬랙 봇과 에이전트가 전부
   따라야 하므로 한 번에 결정해야 한다. 현재 실패 양상은 ~10인 도구에서의
   last-write-wins이고, 마일스톤 날짜 역전만 DB `CHECK`(마이그레이션 0002)로
   막혀 있다.
2. **7개 변경 라우트의 zod 메시지 노출 정책.** 지금은 모든 파싱 실패가 하나의
   일반 400으로 뭉개진다. 필드 경로와 제약 문구를 클라이언트에 얼마나 드러낼지
   결정하는 일이고, 제품 이름 중복(SQLSTATE 23505) 번역도 같은 결정에 속한다.
3. **인박스 그루밍의 `onDone`이 이슈 id로 스코프되지 않는다** — 늦게 도착한
   PATCH 완료가 다른 행의 열린 패널을 닫는다. **자체 게이트를 갖는 별도
   태스크로 잡아라.** Task 6은 이 상태 머신에서만 수정 5라운드를 썼다.
4. **Playwright가 있어야 닫히는 시각 항목**: 드래그 인디케이터 leak(CDP가
   HTML5 드래그 이벤트를 못 쏘아 Phase 2의 어떤 게이트로도 닫을 수 없었다),
   종료 행 `.row-expand` 하단 테두리, `Rail`의 admin 게이팅 렌더 테스트.
5. **Phase 1에서 넘어와 아직 열린 것**: 로그인 rate limiting, 요청 본문 크기
   제한, IT Portal 인증(`src/lib/auth.ts`의 `verifyCredentials`가 유일한 교체
   지점), `SESSION_SECRET`의 부팅 시점 검증(현재는 첫 세션 사용 시 거부).

### 추가로 기록된 후보

- **`starts_on`/`ends_on`을 `date` 컬럼으로.** 지금은 시각이 없는 값을
  `timestamp`에 담고 UTC 자정 관례로 지탱한다. `date(..., {mode:'string'})`이면
  와이어에 `"2026-07-25"`가 실리고 `wireDate()`와 그 관례 전체가 사라진다.
  현재 그 불변식을 지키는 건 zod 한 줄이지 스키마가 아니다. 마이그레이션이라
  Phase 2 범위 밖이었다.
- **보안 알림**: GitHub이 기본 브랜치에 dependabot 취약점 5건(high 3,
  moderate 2)을 보고한다. high 3건은 Next 16이 끌고 오는 `sharp <0.35.0`
  (libvips CVE)이다. `npm audit fix --force`는 **next@9.3.3으로 다운그레이드**를
  제안하므로 절대 그대로 실행하지 마라 — Next 패치 릴리스로 올리는 게 맞는
  경로다. 이 앱이 `next/image`를 쓰지 않는다는 점(픽셀아트 SVG를 인라인으로
  씀)까지 확인해 실제 노출을 판단하고 배포 전에 결론을 내라.

## 인프라 사실 (추측 금지, 확인부터)

- GCP 프로젝트는 `<gcp-project-id>` 하나뿐이다. `<incorrect-project-id-example>` 같은
  이름은 존재하지 않는다 — 빈 gcloud 출력은 보통 "에러 없음"이 아니라
  "프로젝트를 잘못 봄"이다. 로그·IAM 작업 전에 `gcloud config get project`.
- 프로덕션 DB는 기존 Cloud SQL 인스턴스 `<cloud-sql-instance>` 위의 새 데이터베이스
  `rudder`(신규 인프라 0). 슬랙 알림 채널은 `<slack-channel-id>`.
- 슬랙 봇은 별도 저장소(`~/…/<slack-bot-repo>`, Cloud Functions Gen2,
  asia-northeast3)다. 인테이크 작업은 그 저장소를 건드린다.

## 작업 방식 (Phase 2에서 값을 한 것들)

- **superpowers 워크플로**: brainstorming → writing-plans →
  subagent-driven-development. 원장은
  `.superpowers/sdd/<plan>/progress.md`.
- **태스크마다 두 개의 독립 게이트** — Claude 리뷰 + Codex 적대 리뷰. 이게
  Phase 2에서 가장 값을 했다. 두 리뷰어는 **상보적**이었다: Claude가 승인한
  라운드에서 Codex가 실제 경합 조건을 세 번 찾았고, 반대로 Codex의 과잉
  지적(API 재설계 요구 등)은 판례를 근거로 기각했다.
  **자기가 구현한 코드를 자기가 검토하지 마라.** Phase 2 막바지에 내가
  직접 구현한 네 커밋에서 이 규칙을 건너뛰었고, Codex를 뒤늦게 돌렸더니
  Important 4건이 나왔다 — 그중 둘은 내가 문서에 쓴 **거짓 주장**이었다.
- **리뷰어는 판정을 파일로 쓰게 하고 직접 읽어라.** 최종 메시지가 도착하지
  않고 idle로 끝나는 경우가 자주 있다.
- **회귀 테스트는 변이 검증하라** — 고치기 전 코드에 얹어 실제로 실패하는지
  실행해서 확인한다. "통과했다"는 증명이 아니다.
- 병렬 작업은 저장소 **내부** `.worktrees/`에 worktree를 만들고 상대 경로
  심볼릭 링크로 `node_modules`·`.env.local`을 건다(저장소 밖이면 Turbopack이
  "symlink points out of the filesystem root"로 빌드에 실패한다). worktree가
  있는 동안 스위트는 `npx vitest run --dir tests`로 경로를 한정한다.

## 대가를 치른 함정들

- **초록색 스위트는 프로덕션 동작의 증명이 아니다.** 테스트는 PGlite, 운영은
  postgres-js + 실제 Postgres다. Phase 1의 낙관적 잠금은 191개 테스트가 전부
  통과하는 동안 프로덕션에서 매번 실패했다. 트랜잭션·타임스탬프·동시성·드라이버
  에러 형태를 건드렸다면 **실 Postgres로 확인한 뒤에** 완료를 주장하라.
  커버리지 숫자를 맞추려고 라이브 테스트를 목으로 바꾸지 마라.
- **환경 변수는 제품이 도는 곳이 아니라 회귀가 드러나는 곳에 고정한다.**
  KST 표시 테스트를 `TZ=Asia/Seoul`에 고정했더니, 로컬 getter로 되돌리는
  회귀가 KST 호스트에서는 통과해버려 테스트가 무력했다. 지금은
  `America/Los_Angeles`로 고정돼 있다.
- **Next 16은 프로젝트 단위 dev 서버 락을 잡는다.** 두 번째 `next dev`는
  명시적 에러를 내고 죽지만, stdio를 버리는 하네스에서는 원인 모를 실패로
  나타난다. 띄우기 전에 `lsof -iTCP:3000 -sTCP:LISTEN -P`.
- **브리프가 API 계약을 추측하면 결함이 된다.** Phase 2에서 T4·T5·T6·T7이
  전부 이 패턴이었다(예: 관계 삭제 쿼리 파라미터). 계약은 라우트 코드를
  읽어서 확인하고 브리프에 적어라.

## 커뮤니케이션

한국어로 답한다. 코드·식별자·커밋 메시지·`CLAUDE.md`/`AGENTS.md` 내용은 영어.
정확한 숫자를 쓰고("일부"·"다수" 금지), 변경에는 롤백 방법을 함께 적는다.
프로덕션 DB나 배포를 건드리는 작업은 영향 범위와 롤백을 먼저 제시하고
확인을 받은 뒤 실행한다.
