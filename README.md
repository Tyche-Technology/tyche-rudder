# Rudder

한국어 | [English](README.en.md)

Tyche 경량 이슈 트래커. 슬랙·웹·봇으로 들어온 요청을 한 곳에 모아 그루밍하고,
백로그 순서와 로드맵 진척을 관리한다.

상태는 항해 은유로 표기한다 — 입항 대기(Inbox) · 선적 대기(Backlog) ·
항해 중(In Progress) · 배송 완료(Done) · 반송(Rejected) · 정박(On Hold).
코드 안의 enum 값은 표준 영어(`inbox`, `backlog`, …)로 유지한다.

## Architecture

**웹 UI는 REST API의 클라이언트다.** `/api/v1/*`가 API 그 자체이고,
웹·슬랙 봇·AI 에이전트가 모두 같은 엔드포인트를 쓴다. 따라서:

- `src/ui/**`와 `src/app/(app)/**`는 `src/db`·`src/domain`을 **임포트하지 않는다.**
  화면에 필요한 타입은 `src/ui/types.ts`에 별도로 선언한다(중복은 의도된 것).
- 모든 변경은 액터가 기록되는 도메인 함수를 거친다. UI에만 존재하는 로직은 없다.

```
src/app/api/v1/**   REST API (= the API)
src/domain/**       비즈니스 규칙, 이벤트 기록
src/db/**           drizzle 스키마 + 클라이언트
src/ui/**           공유 컴포넌트·훅 (API의 클라이언트)
src/app/(app)/**    다섯 개 화면
design/**           승인된 디자인 목업 + 토큰 원본(rudder.css)
```

`design/rudder.css`가 토큰·컴포넌트의 원본이고 `src/app/globals.css`가 그 사본이다.
스타일을 추가할 때는 **두 파일에 동일하게** 넣는다. 폰트 로딩 두 줄만 의도적으로 다르다.

## Setup

```bash
npm install
docker compose up -d          # postgres 15, 기본 포트 5432
cp .env.example .env.local    # DATABASE_URL, BETTER_AUTH_SECRET
npm run db:migrate
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME=... npm run seed:admin
                              # 최초 admin 1명만. 이후 사용자는 초대로 추가한다
npm run dev                   # http://localhost:3000
```

`BETTER_AUTH_SECRET`은 **직접 생성해야 한다.** `.env.example`은 거부되는
자리표시자 값을 그대로 담고 있다 — 저장소를 아는 사람이면 누구나 임의의 사용자
id로 유효한 세션을 위조할 수 있기 때문이다. 32자 이상이어야 한다(better-auth
자체의 최소 엔트로피 요구사항이자 예전 iron-session 기준과 동일).

`BETTER_AUTH_URL`도 실제 값으로 채워야 한다 — `src/lib/api-auth.ts`의
신뢰-출처(trusted-origin) 가드가 이 값을 신뢰 루트로 쓴다. 이 프로젝트는
`output: "standalone"`으로 빌드하고 `experimental.trustHostHeader`를 켜지
않으므로, 값이 비어 있으면 가드는 서버 자신의 바인드 설정(`HOSTNAME`/`PORT`)에서
유도한 origin으로 대체하는데, 실제 브라우저가 보내는 Origin은 그 값과 절대
일치하지 않는다 — 쿠키를 동반하는 상태 변경 요청(로그인 이후 모든 `POST`/`PATCH`)이
전부 401로 막힌다.

`src/instrumentation.ts`의 `register()`가 `BETTER_AUTH_SECRET`을 **부팅
시점**에 검증한다 — `npm run dev`에서는 값이 없거나, 자리표시자거나, 32자
미만이면 프로세스가 그 자리에서 죽는다. 하지만 이건 dev 한정 보장이다: Next
16의 실제 프로덕션 서버(`next start`/이 프로젝트가 배포하는 standalone
`server.js`)는 `register()`가 던진 예외를 안정적으로 죽음으로 이어주지
않는다 — `NextServer.prepare()`가 `register()`를 fire-and-forget으로
실행하고, 그 실패를 백그라운드 500으로 집어삼킨다(`node_modules/next/dist/server/next.js`
추적, `docker build`한 실제 이미지로 재현 확인). 그래서 배포가 실제로 의지하는
안전장치는 둘 다 Next 바깥에 있다:

- `scripts/docker-entrypoint.sh` — 컨테이너의 `CMD`. Next를 로드하기 전에
  `BETTER_AUTH_SECRET`과 `BETTER_AUTH_URL`을 검증하고, 실패하면 `node server.js`를
  아예 실행하지 않는다(`docker run`으로 직접 재현 확인: 잘못된 시크릿은 컨테이너가
  `Exited (1)`로 즉시 죽고 포트가 열리지 않는다). `BETTER_AUTH_URL`은 값이
  없어도 프로세스가 죽거나 포트가 안 열리는 문제가 아니라서 `/api/health`
  단독으로는 못 잡는다 — 그래서 시크릿과 같은 위치에서 같은 방식(부팅 자체를
  거부)으로 검증한다. 다만 이 검증은 `http://`/`https://` 접두사만 본다 —
  예를 들어 끝에 슬래시가 붙은 값(`https://host/`)은 그대로 통과한다. 이건
  구멍이 아니라 의도된 범위다: 이 값을 읽는 모든 지점(`src/lib/api-auth.ts`의
  신뢰-출처 가드, better-auth 자체의 `baseURL`, `src/app/api/v1/invites/route.ts`)이
  `new URL(x).origin`으로 정규화해서 끝 슬래시를 지우므로, 그 시점엔 이미
  안전하다 — 실제 방어선은 앱 레벨의 정규화이지 이 셸 스크립트가 아니다.
- `GET /api/health` — 단순 liveness가 아니라 `BETTER_AUTH_SECRET` 유효성도
  함께 본다. 배포 파이프라인의 자동 롤백은 애초에 프로세스 종료가 아니라 **이
  엔드포인트를 폴링**해서 판단한다(`deploy/docker-compose.prod.yml`의
  healthcheck, `.github/workflows/deploy.yml`의 wget 루프) — 그래서 이쪽이
  시크릿 쪽의 실제 방어선이다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

로컬 Postgres를 다른 포트로 띄웠다면 `.env.local`의 `DATABASE_URL`을 맞춰 수정한다.

**postgres 16 → 15로 내렸다(볼륨명도 `rudder-pgdata` → `rudder-pgdata-pg15`).**
15가 16이 초기화한 데이터 디렉터리를 열지 못해 예전 볼륨을 그대로 쓰면
`docker compose up -d`가 크래시루프한다 — 그래서 볼륨명 자체를 바꿔 새 볼륨으로
분리했다. 로컬 dev 데이터는 재현 가능하므로(= `npm run seed:admin`) 안전한 선택이다.
예전 볼륨(`<project>_rudder-pgdata`, 보통 `<디렉터리명>_rudder-pgdata`)은 새
`rudder-pgdata-pg15`가 뜬 뒤에도 디스크에 orphan으로 남으니, 필요 없으면
`docker volume rm <project>_rudder-pgdata`로 정리한다.

## ⚠️ dev 서버는 한 번에 하나만

Next 16은 **프로젝트 단위 dev 서버 락**을 잡는다. 두 번째 `next dev`는 명시적
에러를 내고 종료하므로 산출물이 깨지지는 않지만, 그래서 *뜨지 않는다* — 그리고
`session-live` 테스트처럼 자식 프로세스의 stdio를 버리는 쪽에서는 그 에러가 보이지
않아 원인 모를 실패로 나타난다. 실제로 유령 서버 하나 때문에 테스트가 통째로
실패한 적이 있다.

- `next dev` 전에 `lsof -iTCP:3000 -sTCP:LISTEN -P`로 포트를 확인한다.
- 테스트가 중간에 끊겼다면 남은 `next-server` 프로세스를 먼저 정리한다.
  (`pkill` 직후의 `pgrep`은 kill을 앞질러 "정리됨"을 오보한다 — 포트로 확인할 것.)
- `tests/api/session-live.test.ts`는 **스스로** dev 서버(:3101)와
  Postgres 컨테이너(:5434)를 띄웠다 내린다. 이 파일이 도는 동안 별도의
  dev 서버를 띄우지 않는다.
- git worktree를 여러 개 두고 병렬 작업할 때는 `npx vitest run --dir tests`처럼
  경로를 한정한다. 무인자 실행은 worktree 안의 테스트 트리까지 긁어와
  session-live 사본들이 포트를 두고 경합한다.

## Testing

```bash
npm test                      # vitest, PGlite 인메모리 Postgres
npm run coverage:gate         # src/domain + src/lib + src/ui 커버리지 ≥80%
```

실제 Postgres 15와 production build를 지나는 브라우저 여정은 별도로 실행한다.
E2E harness가 Postgres(:5435)와 mock Slack(:3299)을 띄우고 migration·seed·정리를
소유하며, 객체 저장은 임시 `fs:` 버킷을 사용한다.

```bash
lsof -iTCP:3200 -sTCP:LISTEN -P
npm run build
npm run test:e2e              # next start :3200 + Playwright Chromium
```

`scripts/migrate.mjs`가 없는 브랜치에서는 harness가 `npx drizzle-kit migrate`를
직접 실행한다. 실패 trace와 screenshot은 `test-results/e2e/`에 남는다.

게이트 범위는 `src/domain`·`src/lib`·`src/ui`다. `vitest.config.ts`의
`coverage.include`는 `src/ui/*.tsx`도 명시한다 — v8가 테스트가 로드한 컴포넌트
`.tsx`를 어차피 아티팩트에 포함시키므로, 측정 대상을 선언과 일치시켰다(더 좁게
재기 위해 설정을 고치는 쪽이 아니라, 넓게 잡힌 실측을 공식으로 인정하는 쪽).

임계값은 **슬라이스별**이지 전체 평균이 아니다 — `src/domain/**`·`src/lib/**`·
`src/ui/**` 각각 statements/branches/functions/lines 80% 이상을 개별로 통과해야
한다(vitest `coverage.thresholds[glob-pattern]`, `perFile` 없이 — 슬라이스 안에서
강한 파일이 약한 파일을 상쇄하는 건 그대로다, 슬라이스 사이에서는 더 이상 안 된다).
이전에는 하나의 결합 평균이라 건강한 `domain`이 부실한 `ui`를 계속 가려 왔다.
`scripts/coverage-gate.sh`는 네 include glob(`src/domain/**/*.ts`,
`src/lib/**/*.ts`, `src/ui/*.ts`, `src/ui/*.tsx`) 각각이 최소 한 파일과
매치하는지 먼저 확인한다 — 하나라도 매치가 0이면 그 슬라이스는 "측정 대상 없음"으로
조용히 통과할 수 있으므로 게이트를 실패시킨다.

**초록색 스위트는 프로덕션 동작의 증명이 아니다.** 테스트는 PGlite(WASM Postgres)로
돌고 프로덕션은 postgres-js + 실제 Postgres로 돈다. 둘은 이런 지점에서 갈린다:

- **타임스탬프 정밀도** — Postgres `now()`는 마이크로초, postgres-js가 파싱한
  JS `Date`는 밀리초다. Phase 1의 낙관적 잠금이 이 차이로 프로덕션에서 매번
  실패했는데 191개 테스트는 전부 통과했다(현재는 명시적 `version` 컬럼 사용).
- **트랜잭션 직렬화** — PGlite는 단일 커넥션에서 직렬화하므로 동시성 경합이
  테스트에서 관측되지 않는다.
- **시간대 스큐** — KST 호스트에서 PGlite의 `defaultNow()` 값은 JS `Date.now()`보다
  약 9시간 앞선다. 한쪽 방향으로만 경계를 둔 단언은 통과해도 아무것도 증명하지 못한다.

트랜잭션·타임스탬프·동시성·드라이버 에러 형태를 건드렸다면 **실제 Postgres로
확인한 뒤에** 완료를 주장한다.

## 시간 표시는 항상 KST

화면에 보이는 모든 시각은 **Asia/Seoul 고정**이다. 브라우저·서버의 시간대를
따르지 않는다 — 팀이 같은 시계를 봐야 "언제 들어온 요청인가"가 성립한다.

날짜에는 성격이 다른 두 종류가 있고, 둘 다 `src/ui/format.ts`가 소유한다.
컴포넌트에서 표시용으로 ISO 문자열을 직접 자르거나 `toLocaleString()`을 쓰지 않는다
(날짜에서 연·월 숫자를 뽑아 계산하는 곳 — 예: 로드맵의 분기 키 — 은 표시가 아니므로 예외).

| 종류 | 예 | 함수 | 규칙 |
|------|-----|------|------|
| **시점**(instant) | `createdAt`, `updatedAt` | `formatDateTime()` · `shortDate()` | UTC로 저장 → **KST로 변환**해 표시 |
| **날짜 라벨** | 마일스톤 `startsOn`/`endsOn` | `dateLabel()` | Postgres `date` 컬럼에 그대로 저장. 변환할 시각 자체가 없음 |

**비교 기준도 KST다.** 로드맵의 "오늘"은 시점이므로 `kstDayMillis()`로 환산한다
(`timeline.ts`의 `todayMillis`). 따라서 7월 31일 마감인 마일스톤은 **KST 8월 1일
자정에** 지연으로 바뀐다 — UTC 자정(=KST 오전 9시)도, 브라우저 로컬 자정도 아니다.
배 위치·D-day·패널 칩이 모두 이 하나의 답을 쓴다.

마일스톤 기한 자체를 변환하지 않는 이유는 그것이 "7월 25일 마감"이라는 **라벨**이지
특정 순간이 아니기 때문이다. DB 컬럼 자체가 Postgres `date` 타입이라 애초에 시각도
시간대도 없다 — 저장된 값이 곧 "7월 25일"이고 변환할 대상이 없다. (Phase 3 이전에는
`timestamp` 컬럼에 UTC 자정으로 저장했고, 그때는 KST로 변환해도 같은 날짜가 나왔지만
그건 KST가 UTC보다 동쪽이라 우연히 맞아떨어진 것일 뿐 — UTC 서쪽 호스트에서 **로컬
변환은 실제로 하루 전날로 틀렸다.** `date` 컬럼으로 옮기면서 그 우연 자체가 사라졌다.)

시간대 관련 테스트(`tests/ui/format.test.ts`, `tests/ui/timeline.test.ts`)는
`process.env.TZ`를 **KST가 아닌 곳으로** 고정한다. 코드가 KST를 명시하므로 값 자체는
어디서든 같지만, 로컬 getter로 되돌리는 회귀는 KST 호스트에서 티가 나지 않는다
(로컬 = KST이므로 그대로 통과한다). 이 스위트가 도는 곳이 서울 노트북뿐이라,
핀을 빼면 테스트가 잡아야 할 바로 그 회귀를 못 잡는다.

## Auth

사람은 이메일+비밀번호(초대 기반 온보딩) 또는 선택적 Google OAuth로 로그인한다.
에이전트는 여전히 `Bearer rud_*` 토큰을 쓴다 — 이 경로는 이번 better-auth
전환에서 바뀌지 않았다.

```bash
npm run create-token <name>   # 에이전트 토큰 발급
npm run revoke-token <name>   # 에이전트 토큰 취소 (revoked_at 플래그; 프로덕션은 node scripts/revoke-token.mjs)
```

**셀프 서비스 가입은 없다.** 최초 admin은 `npm run seed:admin`으로
부트스트랩하고(`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`/`SEED_ADMIN_NAME`,
admin이 이미 있으면 거부), 이후 사용자는 관리자가 **선원 명부**(`/crew`)에서
발급하는 1회용 초대 링크로만 들어온다(7일 후 만료). Google 로그인은
`disableImplicitSignUp`으로 막아 두어서 초대되지 않은 계정으로는 절대 새
유저를 만들 수 없다 — 이미 존재하는(=초대받은) 유저의 이메일에 계정을 링크할
뿐이다. Google OAuth 콘솔의 리디렉션 URI는 정확히
`<BETTER_AUTH_URL>/api/auth/callback/google`이어야 하고, **Authorized
JavaScript origins는 비워 둔다** — 채우면 이 앱이 의도적으로 막아 둔
id-token 로그인 경로(`disableIdTokenSignIn: true`)가 다시 열린다.

**세션은 더 이상 stateless가 아니다.** iron-session 시절과 달리 better-auth
세션은 DB에 저장되고, 매 요청마다 role/banned를 DB에서 새로 읽는다
(`src/lib/api-auth.ts` — `cookieCache`를 쓰지 않는 것은 의도적이다). 관리자가
계정을 정지하면 그 세션은 **즉시** 죽는다 — 쿠키 만료를 기다리지 않는다.

**Breaking change (Task 11):** 에이전트가 이슈를 생성할 때 보내던
`requesterPortalId` 필드가 `requesterEmail`(기존 유저의 이메일)로 바뀌었다.
`tyche-slack-bot`(다른 리포)의 `rudder_create_issue` 툴과 Slack-유저→Rudder-유저
매핑이 아직 이 계약을 따라가지 못했다 — PR #34로 그쪽을 먼저 갱신하지 않으면
봇이 올리는 이슈가 전부 검증 실패한다
(`docs/superpowers/plans/2026-08-03-rudder-launch-runbook.md`의 prerequisite P3).

## Deploy

`master` 푸시(관련 경로 변경 시) 또는 `workflow_dispatch`로 GCP VM `tyche-rudder`
(asia-northeast3-a, Tailscale tailnet 전용, 공인 IP 없음)에 배포한다.
Cloud Run이 아니라 VM인 이유: Cloud SQL 인스턴스 `tyche-db`가 같은 리전이라
`cloud-sql-proxy` 사이드카로 로컬 연결이 되고, 사람은 `tailscale serve`로만
접근한다(ts.net이 TLS를 종단하므로 `Secure` 쿠키가 그대로 동작). 공인 인그레스가
없어 로그인 rate limiting은 Phase 3 범위에서 의도적으로 뺐다.

```
push(master) → build & push (GHCR, digest pin)
             → migrate.mjs (컨테이너 교체 전, 실패 시 이전 컨테이너가 계속 서빙)
             → docker compose up -d
             → /api/health 헬스체크 → 실패 시 :rollback 태그로 자동 롤백
```

- `Dockerfile`: `node:22-alpine` 3단계 빌드(deps → builder → runner), 논루트
  `node` 유저, `output: 'standalone'`. `drizzle-orm`·`postgres`는 standalone
  트레이싱이 놓쳐서(빌드 그래프에 `migrate.mjs`가 잡히지 않음) 런타임 스테이지에
  명시적으로 복사한다 — 둘 다 자체 의존성이 없는 패키지라 그걸로 충분하다.
  `CMD`는 `node server.js`가 아니라 `scripts/docker-entrypoint.sh`(위
  BETTER_AUTH_SECRET 단락 참고) — Next가 뜨기 전에 `sh`로
  `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`을 미리 검증한다.
- `scripts/migrate.mjs`: `drizzle-kit`(devDependency)을 이미지에 넣지 않고
  런타임 의존성만으로 마이그레이션을 적용한다. 0004~0006은 additive라 실패해도
  롤백 시 스키마를 되돌릴 필요가 없다. **0003은 예외다** — `milestones.starts_on`/
  `ends_on`을 `timestamp`에서 `date`로 바꾸는 단방향 마이그레이션이다. 배포
  파이프라인은 컨테이너 교체 전에 마이그레이션을 적용하고, 롤백은 이미지만
  되돌린다(스키마는 그대로) — 그래서 0003 이후 롤백 이미지로 돌아가면 그
  이미지는 `date` 컬럼의 `"YYYY-MM-DD"` 문자열을 여전히 `timestamp`인 것처럼
  읽는다. 첫 배포에는 롤백 이미지 자체가 없어 무해하지만, 두 번째 배포부터는
  이 경계를 넘는 롤백에 스키마 결정이 필요하다.
- `deploy/docker-compose.prod.yml`: `rudder` + `cloud-sql-proxy` 두 서비스.
  시크릿(`DB_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `SLACK_BOT_TOKEN`, `APP_BASE_URL`, `GCS_BUCKET`, 선택적
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`)은 커밋된 파일에 없고 VM의
  환경(`.env`)에서 읽는다. SA 키는 VM 디스크에서
  `./credentials:/credentials:ro`로 읽기 전용 마운트된다.
- GitHub Actions 시크릿: `VM_HOST`(tailnet 이름 `tyche-rudder`), `VM_USERNAME`,
  `VM_SSH_KEY_BASE64`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`.
- VM·DB·버킷·시크릿 프로비저닝은 별도 런북(Task 14, PO 확인 후 실행) 소관이다.

## Docs

| 문서 | 내용 |
|------|------|
| `docs/superpowers/specs/2026-07-30-issue-tracker-design.md` | PRD (§7 네이밍 규칙, §10 AI 가드레일이 구속력을 가짐) |
| `docs/superpowers/design/2026-07-30-rudder-design-system.md` | 디자인 시스템 규격 (토큰, 신호기, 타임라인 규칙, 카피 덱) |
| `docs/superpowers/plans/2026-07-30-rudder-overview.md` | 페이즈 개요와 이월 항목 |
| `design/index.html` | 살아있는 스타일 가이드 (브라우저로 열면 됨) |

## License

Rudder의 코드는 **GNU AGPL-3.0-only**로 배포된다. 자세한 조건은 [LICENSE](LICENSE)
원문이 기준이고, 아래 요약은 안내일 뿐 해석이 아니다.

Copyright © 2026 Tyche Technologies Co., Ltd.

- 이 소프트웨어를 **수정해서 네트워크로 서비스**하는 경우, AGPL 13조에 따라
  이용자에게 수정된 소스를 제공할 의무가 생길 수 있다.
- 제3자 구성요소(npm 의존성 등)는 각자의 원래 라이선스를 따른다 —
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- "Tyche" 이름·로고 등 브랜드 자산에 대한 상표 사용권은 이 라이선스에 포함되지
  않는다 — [TRADEMARKS.md](TRADEMARKS.md).
- 기여 조건과 CLA(초안, 법률 검토 전)는 [CONTRIBUTING.md](CONTRIBUTING.md)와
  [CLA.md](CLA.md)를 본다.
