# 코치 도메인 hub-om 재구축 설계

작성일: 2026-06-29
상태: 설계 확정 (구현 계획 작성 단계로 진행)

## 배경 / 두 가지 목표

1. **coach-db 종료**: 기존 standalone coach-db(`coach-db.skillflo.app`)는 코치 개인정보를 공개적으로 노출한다. 공개 접근을 차단하고 서비스를 종료한다.
2. **hub-om 재구축**: 코치 관련 기능을 hub-om 코드베이스 안에 정식 도메인으로 재구축한다.

### 핵심 결정 — A안이 아니라 B안(정식 도메인)

초기 초안은 "비식별 리소스(A안)"와 "코치 마스터(B안)"가 섞여 있었다. 최종 방향은 **B안: hub-om 안에 코치를 정식 1급 도메인으로 구축**한다.

- hub-om = 운영 허브 (source of truth)
- coach = hub-om의 정식 마스터 데이터
- engagement = 코치 투입 이력
- schedule = 코치 가용/투입 일정

**목표 1과의 관계 (반드시 명확히 한다):** 이 설계는 PII를 *제거*하지 않는다. PII를 hub-om으로 *이전*하되, **별도 테이블 + 권한 + 감사로그 + export 차단**으로 격리한다. coach-db의 공개 노출은 종료되고, PII는 admin 권한과 접근 로그 하에서만 열람 가능하다.

## 현황 데이터 모델 (분석)

### coach-db (종료 대상)
- `Coach`(사람: name, employeeId, phone, email, birthDate, affiliation, workType, status …)
- `Engagement`(투입이력): `coachId`, `courseName`(**자유 텍스트**, 과정 FK 아님), status, source, dates/times, rating, feedback, rehire, hourlyRate, hiredBy(매니저 이름 텍스트)
- `EngagementSchedule`(일자별 투입 슬롯), `CoachSchedule`(가용 스케줄)
- `CoachField`, `CoachCurriculum`(+ master `Field`, `Curriculum`)

### hub-om (재구축 대상)
- 코치 엔티티 **없음**. `Member`는 OM/LD 내부 운영자 전용 — 코치 아님.
- `OperationSession`(운영)이 코치를 `coachText`/`instructorsText` **자유 텍스트로만** 보유 (구조화 안 됨, 신뢰도 낮음)
- `Course`, `Company`, `OperationSession`은 `@db.Uuid` + `prisma-client-js` generator 사용

## 정석 스키마 — 코치 도메인 (Phase 1)

핵심 원칙: **coaches를 두 층으로 분리.** 업무상 공개 가능한 마스터와 민감 개인정보를 다른 테이블로 둔다. 일반 화면은 `coaches`만 조회하므로 API 실수로 phone/email이 새어 나갈 위험이 구조적으로 줄고, 접근 로그/감사를 붙이기 쉽다.

### `coaches` — 공개 가능 마스터
| 필드 | 비고 |
|------|------|
| id (uuid) | PK |
| sourceCoachId | coach-db Coach.id, 멱등 upsert 키 |
| name | 코치 이름 (PII 아님이나 식별자로 취급 — 무분별 노출 금지) |
| normalizedName | 매칭/검색용 정규화 이름 |
| workType | 근무 유형 |
| status | coach-db 활동 상태: active/inactive/pending |
| isActive | hub-om 운영 노출 여부 (status와 의미 분리) |
| displayOrder | |
| createdAt / updatedAt / deletedAt | soft delete |

> 주의: `name`/`normalizedName`도 현업 기준 식별자다. 일반 hub-om 사용자에게 노출되는 최소 운영 정보로 한정하고, 그 이상(연락처·이메일·사번)은 아래 private 테이블로 격리한다.

### `coach_private_profiles` — 민감/개인정보 (접근 제한)
| 필드 | 비고 |
|------|------|
| coachId (uuid, unique FK) | |
| employeeId | 사번 |
| phone | |
| email | |
| birthDate | |
| affiliation | 소속 |

- admin 권한에서만 조회. 필요 시 마스킹/암호화 대상.
- export는 별도 권한 + 접근 로그 필수.

### `coach_fields`, `coach_curriculums` (+ master `coach_field_masters`, `coach_curriculum_masters`)
- coach-db의 분야/커리큘럼 연결 이식. 마스터 모델명은 `CoachFieldMaster`/`CoachCurriculumMaster` — hub-om에 다른 의미의 "field"가 생길 가능성에 대비해 도메인 prefix로 충돌 방지.

### `coach_schedules` — 가용 스케줄
| 필드 |
|------|
| id, sourceScheduleId, coachId, date, startTime, endTime |

### `coach_engagements` — 투입 이력
| 필드 | 비고 |
|------|------|
| id, sourceEngagementId | source id 멱등 upsert |
| coachId (FK) | |
| operationSessionId? (nullable FK) | **하이브리드**: 매칭 시 연결, 아니면 null |
| courseName | 자유텍스트 폴백 |
| status, source | |
| startDate, endDate, startTime, endTime | |
| rating, rehire | |
| feedback | **제한열람(private 취급)** — 자유입력 주관 평가 |
| hiredById? / hiredByText | hub-om 사용자 FK 우선, 텍스트 폴백 |

### `coach_engagement_schedules` — 일자별 투입 슬롯
| 필드 |
|------|
| id, sourceEngagementScheduleId, engagementId, coachId, date, startTime, endTime, cancelledAt |

### `coach_import_runs` — import 실행 이력/감사
- import 실행 메타데이터, 행 수, 성공/실패, 검증 로그.

## OperationSession 매칭 알고리즘 (하이브리드 FK 채우기)

`operation_sessions.coachText`는 자유입력이라 **employeeId/이름 기반 매칭은 위험** → 사용하지 않는다.

추천 매칭 순서:
1. source engagement의 `courseName` + `startDate` + `endDate`
2. hub-om `OperationSession.course.name` + `startDate` + `endDate`
3. **여러 건 매칭되면 `operationSessionId = null`** (사람이 나중에 수동 연결)
4. 단일 신뢰 매칭일 때만 FK 연결

## migration ≠ import (분리 — 운영 안전)

- **Prisma migration**: 테이블 *구조*만 생성. (`db:migrate:dev` / `db:migrate:deploy`)
- **import script**: coach-db 데이터를 hub-om으로 가져오는 별도 작업. 모든 적재는 **source id 기준 멱등 upsert**. dry-run 우선, 백업 후 실행.
- 이 둘을 한 작업으로 섞지 않는다.

## 단계 (Phases)

### Phase 1 — 정식 스키마
`Coach`, `CoachPrivateProfile`, `CoachField`, `CoachCurriculum`, `CoachSchedule`, `CoachEngagement`, `CoachEngagementSchedule`, `CoachImportRun` (+ master `Field`/`Curriculum`). Prisma migration으로 구조만.

### Phase 2 — import
coach-db 전체를 가져오되 일반 테이블과 private 테이블을 분리 저장. source id 멱등 upsert. OperationSession 매칭은 위 알고리즘, 불확실하면 null.

### Phase 3 — 권한 / 감사
> private 데이터 repository는 Phase 2(데이터 계층 생성) 시점부터 공개 repository와 **별도 인터페이스로 분리**해 둔다. 권한 부착을 나중에 쉽게 하기 위함. (`CoachRepository` / `CoachPrivateRepository`)

- 일반 hub-om 사용자: 이름 / 근무유형 / 분야 / 가용성 / 투입 이력 (단 `feedback`·`hiredByText` 제외)
- admin: 연락처 / 이메일 / employeeId
- export: 별도 권한
- 개인정보 접근 로그 (audit)

### Phase 4 — UI
- `/coaches`: 코치 목록
- `/coaches/[id]`: 코치 상세 (PII는 권한 게이팅)
- `/coaches/[id]/engagements`: 투입 이력
- `/resources/coaches`: 가용성/리소스 판단 화면
- 사이드바 `코치 DB` → `/coaches`

### Phase 0 (병행) — coach-db 종료
- coach-db `COACH_DB_PERSONAL_INFO_DISABLED` 차단 유지 + Coolify env 적용 확인
- hub-om `AppSidebar.tsx`의 외부 `<a href={coachDbUrl}>코치 DB</a>` 제거 → Phase 4 전까지 숨김 또는 disabled "준비 중"

## 준수 사항 (hub-om 컨벤션)

- 작업은 hub-om 레포 `feature/YYYYMMDD-*` 브랜치 (hub-om CLAUDE.md). `main`/`dev` 직접 작업 금지.
- 화면은 원천/DB에 직접 의존 금지 — repository/interface 통해 데이터 접근.
- 실데이터 마이그레이션은 백업 + dry-run 우선. 물리 삭제 금지.
- 실제 데이터 예시·고객사·담당자명·금액·링크는 공개 저장소 커밋 금지.
- DB 스키마/마이그레이션/권한/배포 변경은 머지 전 데이터·기술 책임자 검토.

## 1차 범위 제외 (명시)

삼성 DS/DX 배치, 구글시트·노션 동기화, 알림(Slack/Web Push), 메트릭 대시보드, 코치 본인용 화면(`/coach`)은 이번 범위에서 제외. (이후 별도 과제)
