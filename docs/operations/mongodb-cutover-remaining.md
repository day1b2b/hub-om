# 서비스 이전까지 남은 순서

2026-09-30, 총괄 75125c9(OM 전체 배정·최신 dev307f52f 정합·파일 staging 완료) 이후 운영 반영 작업 기준. 최신 통합 여부는 각 작업의 integration-review를 따른다. 운영에 접속하지 않았으며 날짜나 완료율을 추정하지 않는다. 기능별 최신 증거는 [runtime coverage](mongodb-runtime-coverage.md)와 각 실행·통합 기록을 따른다.

서비스를 Mongo로 옮기는 시점은 아래 세 단계의 차단 항목을 닫고 운영 실행 조건을 확인한 뒤다. 기능 repository 구현이 끝난 시점이나 dev→main 코드 병합만으로 이전 완료를 판단하지 않는다.

## 1. 남은 코드 기능군

| 남은 단위 | 실제 남은 호출 근거 | 선행 관계와 외부 조치 |
| --- | --- | --- |
| 실원천·Drive 실행 연결 | 실제 Sheets/Notion/Drive 연결 및 전체 앱/작업 구성 | 파일 staging·운영 승격·Calendar 명시 경계, Drive 저장 이력 조회·CLI writer, Sheets/Notion 명시 원천→staging은 합성 검증했다. 실제 원천 연결·운영 적재와 전체 실행 구성은 별도 필수 후속이며 합성 성공으로 대체하지 않는다 |
| Calendar 전체 앱/예약 작업 조립 | 기본 PG를 유지한 저장/시각 port와 명시 Mongo lease/runtime | 명시 경계 구현·원본PG/native/합성 Google 검증·독립 수락 완료. 원격 통합은 Calendar 기록을 따른다. 실제 Google 권한/메일·앱과 예약 작업 조립은 미완료 |
| 전체 백업·상태 구성 | 전체 앱 backend 구성 및 실제 복구 검증 | health 연결 확인과 기존 관리자 코치 JSON 다운로드 경계는 합성 검증했다. 전체 DB 백업/복구 증거는 별도이며 실제 복원 검증은 3단계다. activity:prune의 명시 저장소 경계와 실제 CLI entrypoint의 명시 Mongo 연결도 합성 검증했다. 실제 활성 작업·전체 앱 연결은 별도다 |
| CLI·예약 작업·배포 경로 | coverage는 src runtime 중심. 기존 backfill CLI/배포 entrypoint/로컬 파일은 별도 점검 | activity:prune, onsite-required-y, team-user-team-labels backfill은 기본 PG를 유지한 exact shadow selector까지 연결했다. 그 밖의 호출·예약·배포 경로와 사용 여부를 확인하고 필요한 전환을 진행한다. 불명확한 도구를 임의 제외하지 않는다 |

이미 완료된 운영 CRUD·코치 인증/토큰/개인정보 내보내기·일정/예약/투입/평가·코치 시트/Notion 동기화·코치 관리/콘텐츠·담당자 내 페이지·토큰 보완·관리자 과정/삭제 운영/보정/과정명 복원·관리자 DB·공지/첨부·활동 조회·강사 Notion·매출 동기화·OM 접수/전체 배정 경계 전환을 새 미전환 기능으로 반복하지 않는다. 단, 이들의 전체 앱 연결은 다음 단계에 포함한다.

활동 조회 세 API는 `ACTIVITY_READ_BACKEND`의 정확한 기능군 selector까지 연결했다. 기본 PostgreSQL과 monitoring route의 request audit 제외 정책을 유지하며 실제 Mongo에서 인증·입력 오류·고정 503·부분 namespace 무수정 거부를 확인했다. 생산 환경 변수 설정, 운영 데이터 복사, A/B 백업·각 복원과 최종 전환은 여전히 남는다.

공지 목록·상세·수정 페이지와 CRUD·첨부 다운로드 API는 `ANNOUNCEMENT_BACKEND`의 정확한 기능군 selector까지 연결했다. 기본 PostgreSQL과 기존 권한·감사·소프트 삭제를 유지하며 실제 Mongo에서 첨부 byte와 부분 namespace 무수정 거부를 확인했다. 운영 공지·첨부 복사, 생산 환경 변수 설정, A/B 백업·각 복원과 최종 전환은 여전히 남는다.

Hubbot POST는 `HUBBOT_BACKEND`의 기능군 selector까지 연결했다. 합성 responder와 감사만 검증했으며 실제 외부 서비스·생산 환경 변수·최종 전환은 남는다.

`/changes`의 콘텐츠 피드·메모 수정/삭제·평가 수정은 `CHANGES_BACKEND` selector까지 연결했다. 활동 목록은 `ACTIVITY_READ_BACKEND`를 사용한다. 운영 데이터·production 설정·최종 전환은 남는다.

## 2. 전체 Mongo 실행 연결

`runWithDataRepositories`는 현재 테스트/내부 명시 주입 장치다. 생산 요청 전체를 구성하는 진입점은 아직 없다. 여러 factory는 기본 PG adapter를 반환하며, operationRepositoryFactory는 CalendarReflectingOperationRepository(new PrismaOperationRepository()), coachRepositoryFactory는 Prisma 고정이다. 일반 getTeamMemberRepository의 local/Prisma/Notion 선택과 저장용 명단 scope도 구분해야 한다.

내부 운영 포트의 첫 조립 단위는 [Mongo operational runtime](mongodb-operational-runtime.md)으로 묶었다. health·코치 JSON export·request/private audit·activity prune가 같은 borrowed client/database/namespace를 쓰며 빈 shadow만 준비하고 기존 상태는 read-only readiness로만 연다. 이는 생산 요청 전체의 composition root나 backend selector가 아니며 실제 활성 CLI·예약·Next 서버 연결은 남아 있다.

활동 조회의 세 GET은 [Mongo activity read runtime](mongodb-activity-read-runtime.md)으로 조립했다. 이 경계는 route policy상 요청 감사 제외인 `activityReads` 단일 포트이며, 브라우저가 보내는 각 API 요청에 scope가 필요하다는 점을 실제 handler로 검증했다. `/changes`의 코치 콘텐츠 쓰기와 전체 요청 selector는 포함하지 않는다.

공지·첨부는 [Mongo announcement runtime](mongodb-announcement-runtime.md)으로 request audit와 함께 조립했다. 실제 API·페이지 계약과 준비 재실행을 검증했지만, production selector나 전체 Next 요청 composition은 아니다.

`/changes`의 활동 조회·콘텐츠 피드·메모·평가 수정은 [Mongo changes runtime](mongodb-changes-runtime.md)으로 request audit와 함께 조립했다. 실제 네 API handler의 조회·쓰기·감사 계약을 검증했지만, 브라우저 전체 흐름이나 production selector는 아니다.

코치 관리자 페이지의 마스터·삭제 코치 기능은 [Mongo coach-admin runtime](mongodb-coach-admin-runtime.md)으로 request audit와 함께 조립했다. 실제 페이지·API의 복원·영구삭제·감사 계약을 검증했지만, 브라우저 전체 흐름이나 production selector는 아니다.

관리자 DB 페이지·셀 수정은 [Mongo admin-database runtime](mongodb-admin-database-runtime.md)으로 team members·request audit와 함께 조립했다. 실제 페이지·PATCH 계약을 검증했지만 브라우저 전체 흐름이나 production selector는 아니다.

과정 관리·삭제 운영·두 보정은 [Mongo admin-maintenance runtime](mongodb-admin-maintenance-runtime.md)으로 request audit와 함께 조립했다. 실제 연속 API 흐름을 검증했지만 production selector는 아니다.

관리자 사용자 명단·팀·역할과 토큰 조회는 [Mongo user-admin runtime](mongodb-user-admin-runtime.md)으로 request audit와 함께 조립했다. 실제 API 권한·쓰기·중복·최소 응답·삭제 차단을 검증했지만 production selector는 아니다.

코치 본인 토큰 조회와 월 일정 조회·저장은 [Mongo coach-portal runtime](mongodb-coach-portal-runtime.md)으로 request audit와 함께 조립했다. 실제 API 흐름을 검증했지만 production selector는 아니다.

`activity:prune` entrypoint는 [Mongo 활동 정리 CLI runtime](mongodb-activity-prune-cli-runtime.md)으로 기본 PG와 exact 명시 shadow 실행을 분리했다. 준비된 namespace만 열며 실제 운영 예약·배포 구성에는 적용하지 않았다.

강의 후속 알림 GET/POST는 [Mongo 강의 후속 알림 runtime](mongodb-lecture-followup-runtime.md)으로 operations·teamUsers·requestActivity, 명시 Slack port와 Mongo 원자 발송 선점 로그를 조립했다. 동시 요청의 중복 발송 차단과 완료 후 재실행은 검증했지만 실제 Slack과 Coolify 예약·배포 구성은 변경하지 않았다. Slack 성공 뒤 Mongo 완료 기록만 실패하면 선점을 유지하지만, Slack 수락 뒤 응답 유실은 구분할 수 없어 선점을 해제하고 재시도 중복 가능성이 남는다.

코치 Notion·계약·일정·전체 동기화 API는 [Mongo 코치 동기화 작업 runtime](mongodb-sync-jobs-runtime.md)으로 저장·합성 source·실행 로그·요청 감사를 조립했다. 실제 원천과 Coolify 예약·배포 구성은 변경하지 않았다.

강사 Notion·매출·만족도·원천 읽기 상태 API는 각각의 명시 runtime으로 저장·합성 source·요청 감사를 조립했다. Hubbot POST도 [Mongo Hubbot runtime](mongodb-hubbot-runtime.md)으로 합성 responder와 요청 감사를 조립했다. 실제 Anthropic·Notion·Salesmap·Slack·Google Sheets·Calendar·이메일과 Coolify 예약·배포 구성은 변경하지 않았다.

legacy `db:backfill:onsite-required-y` entrypoint는 [Mongo 현장 투입 보정 CLI runtime](mongodb-onsite-backfill-cli-runtime.md)으로 raw SQL을 제거하고 기존 repository를 재사용한다. 기본 PG와 명시 shadow 실행을 검증했지만 실제 운영 보정이나 배포 구성에는 적용하지 않았다.

legacy `db:backfill:team-user-team-labels` entrypoint는 [Mongo 팀 명칭 보정 CLI](mongodb-team-label-backfill-cli.md)로 raw SQL을 제거하고 TeamUser 저장 경계를 사용한다. 실제 운영 라벨 보정이나 배포 구성에는 적용하지 않았다.

남은 기능 구현과 병행해 전체 요청·페이지·작업 실행의 저장소 묶음, 원천 adapter, 요청 감사, Calendar 부작용, 키/오류 처리를 일관되게 연결한다. 누락된 저장소가 PG로 넘어가지 않는지 검사하고 실제 앱/브라우저·권한 흐름을 통합 확인한다. 환경변수 이름만 바꾸는 것으로 완료되지 않는다. 이 연결 코드는 먼저 격리 환경에서 검증하고 운영 설정은 바꾸지 않는다.

health·백업·배포 entrypoint의 Prisma migration 실행 및 활성 CLI/예약 작업을 함께 점검해야 한다. 완성된 repository를 다시 만드는 단계가 아니라 실제 사용 경로에 맞춰 묶고 검증하는 단계다.

## 3. 실제 복사·복원·최종 전환

**실제 백업은 아직 생성·확인되지 않았다.** 데이터 무유실을 필수 수락 기준으로 삼는다. 독립된 두 저장 위치의 백업을 각각 무결성 검사·격리 복원 검증한 뒤에만 실제 복사/전환을 시작한다. 로컬 합성 검증은 운영 백업으로 세지 않는다. 구체적인 대상·두 저장 위치·용량·접근·키 보관 및 실행/검증 계획은 [이중 백업과 전환 절차](mongodb-backup-cutover-plan.md)를 따른다.


1. DB·필수 첨부/파일·암호화 키·복구 설정의 범위와 서로 독립된 백업 위치 A/B, 접근·용량·키 안전 보관·검증 지표·중단/복귀 조건을 확정한다. 각 백업의 무결성과 격리 복원을 별도로 검증한다. 실제 운영 접근과 쓰기는 승인된 범위/백업 확인이 필요하다.
2. PG legacy 평문/암호화·HMAC·필수 schema 상태를 확인하고, 전환 방식에 필요한 schema/codec 호환성을 확인한다. 원본 PG backfill/enforce는 자동 선행조건이 아니며, 필요한 경우 별도 승인된 적용·복구 순서를 따른다. 기존 shadow는 자동 삭제/수리하지 않고 새 namespace 복사 또는 명시 변환 절차를 따른다.
3. 실제 데이터를 일관된 snapshot으로 복사하고 모델별 건수·관계·암호화·식별자·파일 bytes·동기화 상태를 대조한다. 복사 후 변경분·삭제 반영과 재실행도 검증한다.
4. 백업에서 별도 환경으로 실제 복원하고 앱 주요 흐름과 키 복구를 확인한다. 원본 PG를 보존하고, Mongo 전환 후 발생한 쓰기까지 반영하는 복귀 절차를 검증한다. 최신 쓰기를 잃는 단순 PG 재지정은 허용하지 않는다.
5. 최종 쓰기 중단 구간·동기화/sequence 재확인 후 생산 backend·health·작업 설정을 함께 바꾸고 기능/오류/감사를 확인한다. 조건 미충족 시 사전에 정한 복귀 절차를 실행한다.

1단계의 개발·합성 검증은 기존 승인으로 계속 가능하다. 2단계의 격리 앱 연결 검증도 운영 설정 없이 진행할 수 있다. 3단계는 운영 백업·키/접근권한·실데이터 범위·전환 시간대·복구 책임자 등 외부 조치가 필요하며 과거 승인 이력과 별개로 최종 작업의 구체적인 백업·대상 범위·실행 조건 확인 및 완료 증거는 아직 없다. 2026-09-29 기록의 heartbeat ACTIVE는 과거 관찰이다. 이후 사용자 인계는 PAUSED이며 자동 재개하지 않는다. 이번 작업에서 실제 자동화 상태를 조회하거나 설정을 변경하지 않았다. 어떤 자동화 상태도 운영 DB·배포 실행 승인을 대신하지 않는다.

## 확정된 범위와 현재 우선순위 (2026-09-30)

MongoDB 이전 자체와 현재 사용 기능·기존 권한·개인정보 암호화 유지가 필수다. 신규 기능 개선은 추가하지 않는다. 브라우저 임시저장 암호화는 필요 작업으로 보존하되 후속으로 분리하며 이번 Mongo 이전 완료의 선행 조건에서 제외한다. 이 제외를 DB 저장/첨부/키의 보호나 기존 기능 제거 승인으로 해석하지 않는다.

OM 접수·전체 배정은 dc39e19까지 합성 검증·독립 수락·총괄 통합 완료다. 최신dev307f52f의 만족도/Calendar 변경은 일반 merge·의미 검증 후 총괄8e19638에 통합했다. 파일 staging·검토와 운영 승격의 합성 검증 후 Calendar 저장·잠금·실제 backfill 등 필수 전환을 이어간다. 각 수직 단위 시작/통합 전에 dev 차이와 겹치는 파일을 점검한다. 사용이 불명확한 도구는 호출/예약/배포 증거를 확인하기 전 삭제·제외하지 않는다. 실제 운영 DB·키/env·원천·배포·main/dev 변경은 현재 개발 승인 범위에 포함하지 않는다.

Drive 결과 snapshot의 회사명·과정명은 2026-09-30 암호화 정책·companion·PG migration·Mongo codec/validator/index에 반영하고 합성 PG/Mongo에서 전환과 byte 정렬을 검증했다. 운영 migration/backfill/enforce와 새 shadow 재복사는 실행하지 않았다. 운영 collation/TZ는 [읽기 전용 사전 점검](postgres-runtime-contract-preflight.md)을 추가하고 합성 PostgreSQL 17의 C/UTF8/UTC에서 확인했지만 실제 운영 실행 증거는 아직 없다. 전체 앱·작업 조립, 실 A/B 백업·각 복원·복사·최종 전환도 계속 남는다.

2026-10-01에 원천 읽기 상태 API 한 기능군의 PostgreSQL 기본/Mongo shadow 명시 selector를 합성 PostgreSQL·MongoDB에서 검증했다. 이는 production 전체 selector의 첫 조각이며 배포 설정은 그대로다. 다음에는 coverage의 나머지 요청·페이지·작업에 같은 fail-closed 조립을 확장하고, 그 뒤 실제 A/B 백업·각 복원·복사·최종 전환 절차를 완료해야 한다.

같은 날 Notion 가져오기 API에도 기능군 selector를 연결하고 합성 PostgreSQL·MongoDB에서 실제 route 저장을 확인했다. 실제 Notion 원천과 운영 설정은 사용하지 않았다. 나머지 기능군 selector와 전체 앱 조립, 실제 A/B 백업·복원·복사·최종 전환은 계속 남는다.

## 2026-10-01 Google Sheets 가져오기 composition 후속

`feature/20261001-google-sheets-import-composition`에서 기존 tabs/import API에 PostgreSQL 기본/Mongo shadow exact selector를 연결한다. 동작별 최소 scope, source 호출 전 전체 port 준비, 고정 오류·무fallback, 부분 namespace의 validator·index·행 불변을 검증한다. 실행·독립 리뷰·통합은 `../../.claude/plans/mongodb-google-sheets-import-composition/` 기록을 따른다. 실제 Google Sheets·운영 적재·production 배포·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 파일 가져오기 composition 후속

`feature/20261001-import-staging-composition`에서 양식·파일 upload의 exact selector와 최소 scope를 검증했다. 실행·리뷰·통합은 `../../.claude/plans/mongodb-import-staging-composition/`을 따른다. 운영 업로드·production 배포·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 가져오기 승격 composition 후속

`feature/20261001-import-promotion-composition`에서 승격 API의 exact selector와 Calendar 전체 scope를 검증했다. 기록은 `../../.claude/plans/mongodb-import-promotion-composition/`을 따른다. 운영 승격·production 배포·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 가져오기 관리 화면 composition 후속

`feature/20261001-import-pages-composition`에서 목록·상세 page의 exact selector와 open-only imports scope를 검증했다. 권한·404·리다이렉트, PostgreSQL fallback 0건과 부분 namespace 불변을 확인했다. 기록은 `../../.claude/plans/mongodb-import-pages-composition/`을 따른다. 운영 데이터·production 배포·전체 앱 selector·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 Drive 조회 화면 composition 후속

`feature/20261001-drive-import-page-composition`에서 `/drive-import-runs`의 exact selector와 open-only 이력·담당자 명단 scope를 검증했다. workspace 권한·빈 상태·PostgreSQL fallback 0건과 부분 namespace 불변을 확인했다. 기록은 `../../.claude/plans/mongodb-drive-import-page-composition/`을 따른다. 실제 Drive·production 배포·전체 앱 selector·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 Health composition 후속

`feature/20261001-health-composition`에서 `/api/health`의 exact selector와 databaseHealth 단일 scope를 검증했다. 실제 Mongo ping, PostgreSQL fallback 0건과 collection 생성 0건을 확인했다. 기록은 `../../.claude/plans/mongodb-health-composition/`을 따른다. schema/readiness·production 배포·실데이터 이전과 `dev → main`은 미완료다.

## 2026-10-01 관리자 백업 composition 후속

`feature/20261001-admin-backup-composition`에서 코치 JSON export의 exact selector와 백업·감사 scope를 검증했다. 이는 전체 복구 백업이 아니며 운영 A/B 백업·복원·이전과 `dev → main`은 미완료다.

## 2026-10-01 코치 관리자 composition 후속

`feature/20261001-coach-admin-composition`에서 코치 관리자 페이지와 분야·커리큘럼·삭제 코치 API에 PostgreSQL 기본/Mongo shadow exact selector를 연결했다. 기존 soft-delete·복원·관리자 명시 영구삭제를 유지하고 실제 selector의 Mongo 저장·요청/업무 감사·PG fallback 0건과 부분 namespace 불변을 검증했다. 기록은 `../../.claude/plans/mongodb-coach-admin-composition/`을 따른다. 관리자 DB·유지보수 등 나머지 selector, production 배포·운영 데이터·A/B 백업·복원·복사·최종 전환과 `dev → main`은 미완료다.
