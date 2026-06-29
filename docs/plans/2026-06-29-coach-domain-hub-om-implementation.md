# 코치 도메인 hub-om 재구축 — 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** coach-db를 종료하고, 코치를 hub-om의 정식 1급 도메인(마스터 + 투입이력 + 가용 스케줄)으로 재구축하되 PII는 별도 테이블·권한·감사로 격리한다.

**Architecture:** hub-om 기존 관례를 따른다 — Prisma 스키마(`@db.Uuid` + snake_case `@map` + 매핑 enum), repository interface→Prisma 구현→factory 계층, 화면은 표준 타입에만 의존, 서버 컴포넌트 + `requireWorkspaceSession`/`requireAdminSession` 게이팅. coaches(공개)와 coach_private_profiles(민감) 2층 분리. 투입이력은 OperationSession에 nullable FK(하이브리드).

**Tech Stack:** Next.js 16, React 19, NextAuth v5, Prisma 7(`prisma-client-js` + `@prisma/adapter-pg`), PostgreSQL, TypeScript.

**설계 문서:** `docs/plans/2026-06-29-coach-domain-design.md`

**작업 레포/브랜치:** `hub-om` 레포, `feature/20260629-coach-domain` 브랜치 (hub-om CLAUDE.md 규칙 — `main`/`dev` 직접 작업 금지). 단, Phase 0의 coach-db 변경분은 `coach-db` 레포에서 별도 처리.

---

## Phase 0 — coach-db 종료 + 사이드바 정리 (즉시)

### Task 0.1: coach-db 차단 플래그 운영 적용 확인

**Files:**
- 확인: `coach-db/src/middleware.ts` (이미 구현됨 — `COACH_DB_PERSONAL_INFO_DISABLED !== "false"`)
- 확인: `coach-db/.env.example`

**Step 1:** coach-db Coolify 환경변수에 `COACH_DB_PERSONAL_INFO_DISABLED`가 설정되지 않았거나 `"false"`가 아님을 확인 (기본 차단 ON). 미설정이면 명시적으로 `true` 추가.

**Step 2:** 배포 후 수동 확인 — `https://coach-db.skillflo.app/` 접속 시 `/disabled`로 리다이렉트, `GET /api/coaches`가 403 반환.

**Step 3:** 결과 보고 (코드 변경 없음 — 운영 설정만).

### Task 0.2: hub-om 사이드바 외부 coach-db 링크 제거

**Files:**
- Modify: `hub-om/src/components/AppSidebar.tsx:12,47`

**Step 1: 외부 링크 완전 제거 + 메뉴 숨김.** `const coachDbUrl = ...` (line 12) 삭제, `<a href={coachDbUrl}>코치 DB</a>` (line 47) **줄 자체를 제거**한다. "준비 중" disabled 메뉴는 클릭 가능한 것처럼 보여 혼란을 주므로 두지 않는다. Phase 4 완료 시 새 `<Link>`로 다시 추가한다.

**Step 2: 검증.** `npm run lint && npm run typecheck` (hub-om). `coachDbUrl` 미사용 변수 에러 없을 것.

**Step 3: 커밋.**
```bash
git add src/components/AppSidebar.tsx
git commit -m "chore: coach-db 외부 링크 제거 및 메뉴 숨김"
```

> Phase 4 Task 4.5에서 `<Link href="/coaches">코치 DB</Link>`로 다시 추가한다.

---

## Phase 1 — 정식 스키마 (hub-om Prisma migration, 구조만)

> 데이터 적재(import)는 Phase 2에서. 이 단계는 **테이블 구조 생성만** 한다.

### Task 1.1: 코치 도메인 enum + 모델 추가

**Files:**
- Modify: `hub-om/prisma/schema.prisma` (말미에 추가)

**Step 1: enum 추가** (hub-om의 매핑 enum 관례 준수)

```prisma
enum CoachStatus {
  PENDING  @map("pending")
  ACTIVE   @map("active")
  INACTIVE @map("inactive")

  @@map("coach_status")
}

enum CoachEngagementStatus {
  SCHEDULED   @map("scheduled")
  IN_PROGRESS @map("in_progress")
  COMPLETED   @map("completed")
  CANCELLED   @map("cancelled")

  @@map("coach_engagement_status")
}

enum CoachEngagementSource {
  SHEET  @map("sheet")
  MANUAL @map("manual")

  @@map("coach_engagement_source")
}
```

**Step 2: 마스터/공개 모델 추가**

```prisma
model Coach {
  id             String      @id @default(uuid()) @db.Uuid
  sourceCoachId  String      @unique @map("source_coach_id")
  name           String      // 운영상 필요한 식별자 (PII는 아니나 식별자로 취급 — 무분별 노출 금지)
  normalizedName String      @map("normalized_name")
  workType       String?     @map("work_type")
  status         CoachStatus @default(ACTIVE) // coach-db 활동 상태: active/inactive/pending
  isActive       Boolean     @default(true) @map("is_active") // hub-om 운영 노출 여부 (status와 의미 분리)
  displayOrder   Int?        @map("display_order")
  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")
  deletedAt      DateTime?   @map("deleted_at")

  privateProfile      CoachPrivateProfile?
  fields              CoachField[]
  curriculums         CoachCurriculum[]
  schedules           CoachSchedule[]
  engagements         CoachEngagement[]
  engagementSchedules CoachEngagementSchedule[]

  @@index([normalizedName])
  @@index([status, isActive])
  @@map("coaches")
}

model CoachPrivateProfile {
  coachId     String    @id @map("coach_id") @db.Uuid
  employeeId  String?   @map("employee_id")
  phone       String?
  email       String?
  birthDate   DateTime? @map("birth_date") @db.Date
  affiliation String?
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  coach Coach @relation(fields: [coachId], references: [id], onDelete: Cascade)

  @@map("coach_private_profiles")
}

// hub-om에 다른 의미의 "field"가 생길 가능성 → 도메인 prefix로 충돌 방지
model CoachFieldMaster {
  id      String       @id @default(uuid()) @db.Uuid
  name    String       @unique
  coaches CoachField[]

  @@map("coach_field_masters")
}

model CoachCurriculumMaster {
  id      String            @id @default(uuid()) @db.Uuid
  name    String            @unique
  coaches CoachCurriculum[]

  @@map("coach_curriculum_masters")
}

model CoachField {
  coachId String @map("coach_id") @db.Uuid
  tagId   String @map("tag_id") @db.Uuid
  coach   Coach            @relation(fields: [coachId], references: [id], onDelete: Cascade)
  tag     CoachFieldMaster @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([coachId, tagId])
  @@map("coach_fields")
}

model CoachCurriculum {
  coachId String @map("coach_id") @db.Uuid
  tagId   String @map("tag_id") @db.Uuid
  coach   Coach                 @relation(fields: [coachId], references: [id], onDelete: Cascade)
  tag     CoachCurriculumMaster @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([coachId, tagId])
  @@map("coach_curriculums")
}
```

**Step 3: 스케줄/투입 모델 추가**

```prisma
model CoachSchedule {
  id              String   @id @default(uuid()) @db.Uuid
  sourceScheduleId String  @unique @map("source_schedule_id")
  coachId         String   @map("coach_id") @db.Uuid
  date            DateTime @db.Date
  startTime       String   @map("start_time")
  endTime         String   @map("end_time")
  updatedAt       DateTime @updatedAt @map("updated_at")

  coach Coach @relation(fields: [coachId], references: [id], onDelete: Cascade)

  @@index([coachId, date])
  @@map("coach_schedules")
}

model CoachEngagement {
  id                 String                @id @default(uuid()) @db.Uuid
  sourceEngagementId String                @unique @map("source_engagement_id")
  coachId            String                @map("coach_id") @db.Uuid
  operationSessionId String?               @map("operation_session_id") @db.Uuid
  courseName         String                @map("course_name")
  status             CoachEngagementStatus @default(SCHEDULED)
  source             CoachEngagementSource @default(MANUAL)
  startDate          DateTime              @map("start_date") @db.Date
  endDate            DateTime              @map("end_date") @db.Date
  startTime          String?               @map("start_time")
  endTime            String?               @map("end_time")
  rating             Int?                  @db.SmallInt
  rehire             Boolean?
  feedback           String?               // private 성격 강함(자유입력·민감 평가) → 1차 UI 기본 숨김, admin 전용
  hiredById          String?               @map("hired_by_id")   // hub-om 사용자 FK 우선
  hiredByText        String?               @map("hired_by_text") // 직원 이름일 수 있음 → private 취급, 1차 UI 기본 숨김
  createdAt          DateTime              @default(now()) @map("created_at")

  coach            Coach             @relation(fields: [coachId], references: [id], onDelete: Cascade)
  operationSession OperationSession? @relation(fields: [operationSessionId], references: [id])
  schedules        CoachEngagementSchedule[]

  @@index([coachId])
  @@index([operationSessionId])
  @@map("coach_engagements")
}

model CoachEngagementSchedule {
  id                         String     @id @default(uuid()) @db.Uuid
  sourceEngagementScheduleId String     @unique @map("source_engagement_schedule_id")
  engagementId               String     @map("engagement_id") @db.Uuid
  coachId                    String     @map("coach_id") @db.Uuid
  date                       DateTime   @db.Date
  startTime                  String     @map("start_time")
  endTime                    String     @map("end_time")
  cancelledAt                DateTime?  @map("cancelled_at")

  engagement CoachEngagement @relation(fields: [engagementId], references: [id], onDelete: Cascade)
  coach      Coach           @relation(fields: [coachId], references: [id], onDelete: Cascade)

  @@index([coachId, date])
  @@index([date])
  @@map("coach_engagement_schedules")
}

model CoachImportRun {
  id           String       @id @default(uuid()) @db.Uuid
  mode         String       @default("dry_run")
  status       ImportStatus @default(PENDING)
  coachCount   Int          @default(0) @map("coach_count")
  engagementCount Int       @default(0) @map("engagement_count")
  scheduleCount   Int       @default(0) @map("schedule_count")
  matchedOperationCount Int @default(0) @map("matched_operation_count")
  errorCount   Int          @default(0) @map("error_count")
  summary      Json?
  notes        String?
  startedAt    DateTime     @default(now()) @map("started_at")
  finishedAt   DateTime?    @map("finished_at")

  @@index([startedAt])
  @@map("coach_import_runs")
}
```

**Step 4: OperationSession 역참조 추가.** `model OperationSession`에 관계 필드 한 줄 추가:
```prisma
  coachEngagements CoachEngagement[]
```

**Step 5: 검증.**
```bash
npm run db:validate
```
Expected: `The schema ... is valid 🚀`

**Step 6: 마이그레이션 생성 (로컬 DB).**
```bash
npm run db:migrate:dev -- --name add_coach_domain
npm run db:generate
```
Expected: `migrations/<timestamp>_add_coach_domain/migration.sql` 생성, Prisma Client 재생성.

**Step 7: 커밋.**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: 코치 도메인 스키마 추가 (coaches/private/engagement/schedule)"
```

---

## Phase 2 — import (coach-db → hub-om, 멱등)

> migration과 분리된 **별도 스크립트**. 화면 작업과 무관하게 독립 실행. dry-run 우선.

### Task 2.1: 표준 타입 + repository interface

**Files:**
- Create: `hub-om/src/lib/data/coachTypes.ts` — 화면이 의존할 표준 타입 (Prisma 타입 노출 금지). `CoachSummary`(공개 필드만), `CoachDetail`, `CoachPrivateProfile`(별도), `CoachEngagementView`, `CoachScheduleView`.
- Create: `hub-om/src/lib/data/coachRepository.ts` — **공개 전용** interface (private 메서드 없음):
  ```ts
  export interface CoachRepository {
    listCoaches(): Promise<CoachSummary[]>;
    getCoachById(id: string): Promise<CoachDetail | null>;
    listEngagements(coachId: string): Promise<CoachEngagementView[]>; // feedback/hiredByText 미포함
    listSchedules(coachId: string, range: DateRange): Promise<CoachScheduleView[]>;
  }
  ```
- Create: `hub-om/src/lib/data/coachPrivateRepository.ts` — **민감정보 전용 별도 interface** (Phase 1부터 분리해 두어 Phase 3 권한 부착을 쉽게 함):
  ```ts
  export interface CoachPrivateRepository {
    getPrivateProfile(coachId: string): Promise<CoachPrivateProfileView | null>;
    getEngagementFeedback(coachId: string): Promise<CoachEngagementFeedbackView[]>; // feedback + hiredByText
  }
  ```
- Create: `hub-om/src/lib/data/prismaCoachRepository.ts`, `prismaCoachPrivateRepository.ts` — Prisma 구현. `getPrismaClient()` 사용. **공개 repository는 private 필드를 select하지 않는다** (구조적 PII 누출 차단). `feedback`/`hiredByText`는 공개 repository에서 절대 반환하지 않는다.
- Create: `hub-om/src/lib/data/coachRepositoryFactory.ts`, `coachPrivateRepositoryFactory.ts` — `operationRepositoryFactory.ts` 패턴 그대로.

**검증:** `npm run typecheck`. **커밋:** `feat: 코치 repository 계층 추가`.

### Task 2.2: 이름 정규화 유틸 재사용

**Files:**
- 확인/재사용: `hub-om/src/lib/data/personNames.ts` (`splitPersonNames`, 정규화 함수 존재). 코치 `normalizedName` 생성에 동일 정규화 사용.

### Task 2.3: 매칭 함수 (TDD)

**Files:**
- Create: `hub-om/src/lib/data/coachImport/matchOperation.ts`
- Test: `hub-om/src/lib/data/coachImport/matchOperation.test.ts`

**Step 1: 실패 테스트.** 입력: engagement `{courseName, startDate, endDate}` + 후보 OperationSession 목록. 규칙:
- `course.name` 정규화 일치 + `startDate` + `endDate` 모두 일치하는 후보가 **정확히 1건** → 그 id 반환
- 0건 또는 2건 이상 → `null` 반환
```ts
test("단일 신뢰 매칭이면 operationSessionId 반환", () => { ... expect(match).toBe(opId) })
test("다중 매칭이면 null", () => { ... expect(match).toBeNull() })
test("매칭 없으면 null", () => { ... expect(match).toBeNull() })
```

**Step 2:** 테스트 실패 확인 → **Step 3:** 최소 구현 → **Step 4:** 통과 확인 → **Step 5:** 커밋 `feat: 투입이력-운영 매칭 함수`.

> 주의: `operation_sessions.coachText`/employeeId/이름 기반 매칭은 **사용 금지** (신뢰도 낮음).

### Task 2.4: import 스크립트 (멱등 upsert, dry-run)

**Files:**
- Create: `hub-om/scripts/import-coach-db.mjs` (기존 `scripts/import-*.mjs` 패턴)
- 참고: coach-db DB 연결은 별도 env `COACH_DB_DATABASE_URL` (읽기 전용 권장)

**동작:**
1. `--dry-run`(기본) / `--apply` 플래그. dry-run은 카운트/매칭 결과만 출력, write 없음.
2. coach-db에서 Coach/Engagement/EngagementSchedule/CoachSchedule/CoachField/CoachCurriculum 읽기.
3. **분리 저장**: 공개 필드 → `coaches`, 민감 필드(employeeId/phone/email/birthDate/affiliation) → `coach_private_profiles`.
4. 모든 upsert는 **source id 기준 멱등**: `coaches.sourceCoachId`, `coach_engagements.sourceEngagementId`, `coach_schedules.sourceScheduleId`, `coach_engagement_schedules.sourceEngagementScheduleId`. (재실행해도 중복 생성 없음)
5. `feedback` → engagement에 저장(제한열람), `hiredBy`(텍스트) → `hiredByText`로 저장(FK 해석은 후속).
6. engagement마다 Task 2.3 매칭 호출 → 단일 신뢰 매칭이면 `operationSessionId` 설정, 아니면 null.
7. 실행 메타를 `coach_import_runs`에 기록.

**Step 1:** dry-run 실행, 출력 검증:
```bash
COACH_DB_DATABASE_URL=... npm run db:import:coach -- --dry-run
```
Expected: `코치 81 / 투입 327 / 스케줄 N / 운영매칭 M건 / 미매칭 K건` 형태 요약, write 0.

**Step 2:** 백업 확인 후 apply (운영 DB 영향 — hub-om CLAUDE.md `db-write-safety.md` 준수):
```bash
COACH_DB_DATABASE_URL=... npm run db:import:coach -- --apply
```
**Step 3:** 멱등성 검증 — apply **2회** 실행 후 행 수 동일 확인.
**Step 4:** `package.json`에 `db:import:coach` 스크립트 등록.
**Step 5:** 커밋 `feat: coach-db→hub-om import 스크립트 (멱등, 공개/민감 분리)`.

---

## Phase 3 — 권한 / 감사

### Task 3.1: 권한 계층 정의

- 일반 워크스페이스 사용자(`requireWorkspaceSession`): `coaches` 공개 필드 + 분야/커리큘럼/가용성/투입이력(단 engagement `feedback` 제외).
- admin(`requireAdminSession`): + `coach_private_profiles`(연락처/이메일/employeeId) + engagement `feedback`.
- 구현: private 데이터는 **별도 라우트/서버액션**에서만 조회하고 진입에 `requireAdminSession()` 적용. 일반 repository 메서드는 private select 안 함(이미 Task 2.1에서 구조적 차단).

### Task 3.2: 개인정보 접근 로그 (audit)

**Files:**
- Modify: `prisma/schema.prisma` — `CoachPrivateAccessLog { id, coachId, accessedByEmail, accessedAt, context }` 추가 + migration.
- Modify: private 조회 경로 — 조회 시 로그 1행 기록.

**검증:** admin이 코치 상세의 연락처 열람 시 로그 적재 확인. 비-admin 접근 시 `/dashboard` 리다이렉트.

### Task 3.3: export 차단

- 코치 목록/상세에 일괄 export(csv 등) 제공 시 `requireAdminSession` + 별도 audit. 1차에는 export 기능을 **제공하지 않음**(YAGNI) — 추가 요청 시에만.

---

## Phase 4 — UI

> hub-om 페이지 관례: 서버 컴포넌트 + `requireWorkspaceSession` + repository → `src/features/coaches/*` 컴포넌트 렌더. `export const dynamic = "force-dynamic"`.

### Task 4.1: `/coaches` 목록
- Create: `src/app/coaches/page.tsx`, `src/features/coaches/CoachList.tsx`
- 공개 필드만(이름/근무유형/상태/분야). PII 없음. 검색/필터.

### Task 4.2: `/coaches/[id]` 상세
- Create: `src/app/coaches/[id]/page.tsx`, `src/features/coaches/CoachDetail.tsx`
- 공개 정보 기본 표시. 연락처/이메일/employeeId 블록은 `requireAdminSession` 통과 + audit 시에만 렌더.

### Task 4.3: `/coaches/[id]/engagements` 투입 이력
- Create: `src/app/coaches/[id]/engagements/page.tsx`, feature 컴포넌트
- 투입이력 목록. `operationSessionId` 있으면 운영 상세로 링크, 없으면 `courseName` 텍스트 + "운영 미연결" 배지(수동 연결 유도). `feedback`·`hiredByText`는 **기본 숨김**, admin(`requireAdminSession` + audit)에서만 표시 — `CoachPrivateRepository` 경유.

### Task 4.4: `/resources/coaches` 가용성/리소스 판단 뷰
- Create: `src/app/resources/coaches/page.tsx`, feature 컴포넌트
- 기간 선택 → 코치별 가용 스케줄 − 투입 스케줄로 가용성 표시.

### Task 4.5: 사이드바 연결
- Modify: `src/components/AppSidebar.tsx` — Phase 0의 "준비 중" `<span>`을 `<Link href="/coaches">코치 DB</Link>`로 교체.
- 검증: `npm run lint && npm run typecheck && npm run build`.
- 커밋 `feat: 코치 도메인 UI 연결 및 사이드바 활성화`.

---

## 전환 / 마무리

- hub-om 검증 완료 후 hub-om을 코치 데이터 source of truth로 전환.
- coach-db는 archive (DB 백업 보관, 앱 차단 유지).
- 각 Phase는 PR로 분리. PR 설명에 변경 목적/파일/검증 명령/남은 리스크/스키마·권한·배포 변경 여부 기재 (hub-om CLAUDE.md PR 규칙).

## 미해결/후속 (1차 범위 외)
- 삼성 DS/DX, 구글시트·노션 동기화, 알림(Slack/Web Push), 메트릭, 코치 본인용 화면(`/coach`).
- `hiredByText` → hub-om 사용자 FK 정식 해석.
- 미매칭 engagement의 운영 수동 연결 UI.
