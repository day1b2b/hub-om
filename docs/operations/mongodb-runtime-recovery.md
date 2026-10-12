# 코치 관리·Calendar 역반영 준비 검사와 복구

## 원인과 변경

코치 관리의 `CoachCatalogGuard`는 `47b9ba6e`(2026-09-22, 작성자 HA YEONHEE)의 코치 시트 동기화·동시 수정 보호에서 추가됐다. 코치 관리, 코치 쓰기, 코치 투입 저장소의 open은 이를 필수로 검사한다. 그러나 `prepare-mongodb-shadow-runtime.ts`는 전체 업무 모델 복사 검증과 Calendar/운영/OM-request 준비만 호출했다. 업무 모델 목록에 없는 내부 catalog guard를 준비하지 않아, 이 스크립트의 성공만으로 코치 runtime 준비를 보장하지 못했다. 특정 운영 실행자가 어떤 명령을 실행했는지는 코드 이력만으로 확정할 수 없다.

Calendar 역반영 route에는 composition 인자가 없어 기본 Prisma 경로로 들어갔다. 이제 GET·POST 모두 기존 `OPERATION_WRITE_BACKEND` selector의 Calendar-aware runtime을 사용한다. `mongodb-shadow`이면 operations, calendarPersistence, calendarLock, teamUsers, requestActivity를 같은 client/database/namespace에서 연다. 준비 실패 시 PostgreSQL로 재시도하지 않는다. 기존 PostgreSQL selector 동작은 유지한다. 새로운 selector는 없다.

## 배포 전 필수 검사

배포 대상의 비밀 환경변수를 안전하게 주입한 같은 네트워크 환경에서 아래 두 검사를 모두 수행한다. 비밀값이나 실제 응답 본문은 기록하지 않는다.

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-deployment.ts --expect=mongodb-shadow
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-runtime.ts
```

두 번째 명령은 DB에 연결하지만 쓰지 않는다. Calendar runtime과 코치 catalog/scheduling guard를 검사하고, catalog가 준비돼 있으면 코치 관리·관리 API·변경 runtime도 실제로 연다. 필수 구조 누락·기존 validator/index 불일치는 종료 코드 1이다. 전체 앱의 모든 runtime 준비를 보증하는 검사는 아니다. 두 검사 중 하나라도 실패하면 배포·예약 작업 재개를 중단한다.

## 누락 catalog만 복구

운영 실행 전 데이터 책임자의 백업 확인과 정확한 DB/namespace 범위 승인이 필요하다. 다음 명령은 승인 후에만 실행한다. `<database>/<namespace>`는 배포 환경과 정확히 일치해야 한다.

```bash
MONGODB_ALLOW_SHADOW_WRITES=true node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs scripts/check-mongodb-runtime.ts --prepare-missing-internal-structures --confirm-target=<database>/<namespace> --backup-confirmed
```

변경 범위는 해당 namespace의 `CoachCatalogGuard`가 없을 때 컬렉션 1개를 만드는 것뿐이다. 기존 strict/error validator, simple collation, 기본 `_id` index 계약을 적용한다. 업무 문서 수정·삭제, 데이터 복사, guard 문서 초기 삽입, 기존 validator/index 변경은 하지 않는다. 정상 컬렉션에는 재실행해도 쓰지 않는다. 잘못된 기존 구조는 자동 수리하지 않는다. 생성 후 다른 코치 runtime 검사에서 실패할 수 있으며, 이 경우 생성된 빈 guard를 삭제하지 말고 남은 준비 오류를 별도로 조사한다.

빈 namespace·오타를 막기 위해 기존 scheduling guard 및 Coach/CoachContentEntry/CoachEngagement 컬렉션 존재를 먼저 확인한다. Calendar 준비 검사도 생성 전에 통과해야 한다. 백업 플래그는 백업의 존재를 자동 검증하지 않으므로 실제 백업·복원 가능 여부는 책임자가 확인한다.

복구 후 읽기 전용 검사를 다시 실행한다. 수정된 이미지를 승인된 절차로 배포한 다음 `/coaches/admin`, `/api/coaches`, `/api/admin/schedule-registration/[yearMonth]` 및 Calendar GET을 확인한다. GET도 요청 감사 로그는 쓸 수 있다. Calendar GET 계획을 확인한 뒤 POST 재실행·5분 예약 작업 재개를 별도 승인 범위에서 수행한다. POST는 운영 일정과 Google Calendar를 변경할 수 있다.

이 코드 작업은 운영 복구 명령, 실제 데이터 변경, 예약 작업 재실행, 배포를 실행하지 않는다. PostgreSQL migration도 포함하지 않는다.

## 인계 메모

2026-10-12 KST 사용자 요청으로 두 스레드 모두 중단. 아래 변경은 미커밋 상태이며, 커밋·push·PR·운영 배포는 하지 않았다. 중단 후에는 이 인계 메모만 추가했다.

### 확인한 원인

- 코치 관리: 운영 Mongo namespace에 `CoachCatalogGuard`가 없다. 코치 관리·관리 API·일정 등록 조회의 runtime 준비 검사가 이를 필수로 요구한다. 일반 코치 목록은 다른 읽기 경로여서 정상이다. 전환 준비 스크립트에 내부 guard 준비와 해당 runtime 검사가 누락돼 있었다.
- 캘린더 동기화: `/api/sync/calendar-events`에 Mongo composition 연결이 없어 PostgreSQL 경로로 들어간다. 운영 컨테이너의 동일 Prisma 조회에서 `P2021`을 재현했고, PostgreSQL에 `course_common_notes`가 없음을 확인했다. Google 토큰 갱신과 세 캘린더 읽기는 모두 HTTP 200이었다.

### 변경 파일과 목적

500 복구 작업 위치: `/Users/ga/.codex/worktrees/mongo-runtime-recovery/hub-om`, 브랜치 `fix/20261012-mongo-runtime-recovery`.

- `src/app/api/sync/calendar-events/route.ts`: GET·POST에 기존 Mongo-aware operation composition 연결.
- `src/lib/data/mongoCoachCatalogRecovery.ts`: 누락 catalog guard만 제한적으로 준비하는 복구 로직.
- `scripts/check-mongodb-runtime.ts`: 기본 읽기 전용 준비 검사와 명시적 대상·백업 확인을 요구하는 복구 진입점.
- `scripts/prepare-mongodb-shadow-runtime.ts`: catalog guard 준비와 코치 runtime 검사 추가.
- `src/lib/data/mongoCoachCatalogRecovery.integration.test.ts`: 읽기 전용 기본값·재실행·잘못된 구조 거부 검증.
- `src/lib/data/coachAdminComposition.integration.test.ts`: 코치 관리 경로의 준비 누락과 복구 후 동작 검증.
- `src/lib/data/mongoCalendarHandlers.integration.test.ts`: 실제 Calendar 핸들러의 Mongo 연결·날짜 변경·재실행 검증 확장.
- `docs/operations/mongodb-deployment-selector-check.md`: 배포 전 runtime 검사 안내.
- `docs/operations/mongodb-runtime-recovery.md`: 원인·복구 범위·승인 조건과 본 인계 메모.

앞선 Slack 알림·과정 삭제 작업은 `/Users/ga/workspace/hub-om`에 별도로 남아 있다. `fix/20261012-om-notification-calendar`는 이 스레드에서 2026-10-12 17:09:29 KST에 `origin/dev`로부터 만든 브랜치다. 현재 기본 작업 폴더의 체크아웃은 `feature/20261012-mongo-db-env-separation-release`이므로, 브랜치 이름만 보고 변경이 저장됐다고 가정하지 말 것.

- `src/lib/data/omRequest/omRequestOperationLink.ts`: 운영 상세 OM 변경 후 기존 Slack 스레드 알림 추가, 같은 담당자 재저장 제외.
- `src/app/api/operations/[operationId]/drive-import/apply/route.ts`: 변경 전 OM을 알림 비교에 전달.
- `src/lib/data/omRequest/omAssignmentNotification.test.ts`, `src/lib/slack/notifySlack.thread.test.ts`: 배정·재배정·중복 제외·OM/LD 멘션과 스레드 검증.
- `src/lib/data/courseAdminRepository.ts`, `src/lib/data/mongoCourseAdminRepository.ts`, `src/lib/data/prismaCourseAdminRepository.ts`: 삭제된 과정 회차 ID 조회 추가.
- `src/lib/data/courseDeletionComposition.ts`: 과정 삭제용 Calendar-aware Mongo scope 구성.
- `src/app/api/admin/courses/[courseId]/route.ts`: 과정 소프트 삭제 후 Calendar 정리 및 재시도 결과 반환.
- `src/features/admin/CourseDeletePanel.tsx`: Calendar 정리 실패 시 재시도 안내.
- `src/lib/googleCalendar/reflectOperationToCalendar.ts`: 삭제 재시도 시 복원된 회차 보호.
- `src/lib/data/courseDeletionComposition.test.ts`, `src/app/api/admin/courses/[courseId]/route.test.ts`, `src/lib/data/mongoCourseAdminHandlers.integration.test.ts`, `src/lib/googleCalendar/reflectOperationToCalendar.test.ts`: scope·권한·삭제·실패 보존·재시도 검증.

### 미완료 및 검증

- 두 작업 모두 운영 미반영. 기존 누락 Slack 알림 재발송과 잔존 Calendar 일정 복구도 미실행. 운영 준비 변경은 백업·대상 범위 승인 후 별도 실행해야 한다. 진행 중인 DB 분리 작업과 변경을 섞지 말 것.
- Slack/과정 삭제: `npm test` 1,439 통과·178 생략·실패 0. 별도 로컬 Mongo 통합 테스트 7 통과. `npm run typecheck`, `npm run build` 통과. `npm run lint` 오류 0·경고 11. `git diff --check` 통과.
- 500 복구: `npm test` 1,433 통과·179 생략·실패 0. typecheck/build 통과, lint 오류 0·경고 11. 로컬 Mongo에서 코치 준비 누락→복구 및 guard 재실행·잘못된 구조 거부 확인.
- 500 복구의 최종 확장 Mongo 테스트는 17 통과·1 취소로 완료되지 않았다. Calendar 테스트에 `Promise resolution is still pending but the event loop has already resolved`가 남아 있으므로 성공으로 취급하지 말고 Claude가 재검증할 것. 로그: `/tmp/hub-om-runtime-recovery-targeted2.log`.
- 500 복구의 최초 Prisma 생성은 `DATABASE_URL` 미설정으로 실패했고, 이후 접속 불가능한 합성 URL로 코드 생성·빌드가 통과했다. 운영 DB로 생성/빌드를 수행하지 않았다. 로컬 테스트 Mongo 프로세스는 종료했다.

### 운영에서 실행한 명령

원래 진단 스레드에서 2026-10-12 KST에 Coolify 컨테이너의 `node -e`로 아래를 실행했다. 정확한 개별 실행 시각은 별도 기록하지 않았다. 비밀값·실데이터 본문은 출력하지 않았다.

- 선택된 backend·DB 이름·namespace 출력, `DATABASE_URL` 존재 여부 확인.
- 인증된 `GET http://127.0.0.1:3000/api/sync/calendar-events`: HTTP 500 확인. 업무 데이터 변경용 POST는 실행하지 않았다. 단, GET의 `withActivity`가 감사 로그 저장 및 조건부 로그 보존기간 정리를 시도할 수 있으므로 운영 DB 쓰기가 전혀 없었다고 단정할 수 없다. 실제 감사 로그 쓰기 성공 여부는 미확인이다.
- Mongo `listCollections`: catalog/scheduling guard와 관련 업무 컬렉션의 존재·검증 설정 조회.
- PostgreSQL `SELECT 1`, `SELECT count(*)::int AS n FROM operation_sessions`, `SELECT count(*)::int AS n FROM calendar_event_links`.
- Prisma `operationSession.findMany`(course/company/commonNote/sourceRecords 포함), `courseIdLabel.findMany`, `calendarEventLink.findMany`: 조회 실패 지점 확인.
- `SELECT table_name FROM information_schema.tables WHERE table_schema = $1` (`public`): 누락 테이블 확인.
- Google OAuth 토큰 갱신 요청과 세 Calendar의 events GET(`maxResults=1`, 최근 1시간): 상태 코드만 확인. 일정 변경 없음.
- 별도 500 복구 스레드의 운영 명령: 없음.
- 이번 Slack/Calendar 및 500 오류 대응에서 운영 `prepare`, 컬렉션 생성, 복구 스크립트, migration, 업무 데이터 직접 수정/삭제: 없음. 로컬 합성 DB에서만 준비·쓰기 테스트를 실행했다.
