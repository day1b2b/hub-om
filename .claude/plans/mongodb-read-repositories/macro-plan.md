# MongoDB 병렬 이전 상위 계획

최신 총괄 상태: Notion 4430763 통합 및 전체876pass19skip0fail 재실행·독립 검토 완료. 근거는 ../mongodb-coach-notion-sync/integration-review.md. 다음 작업은 이름 포함 원천 식별자 암호화 정책·고유키/검색·snapshot/runtime·기존 데이터 변환 보완이다. 운영 PG와 실제 데이터는 유지한다.

목표: 기존 PostgreSQL 운영을 유지하며 개인정보를 암호화한 별도 MongoDB를 검증한 뒤 안전하게 전환한다.

1. 복사 기반: 35모델 read-only export, 암호화 spool, insert-only import와 참조/고유키 검증. 코드와 합성 검증 완료, 실제 복사 미실행.
2. 런타임 전환: Operation 작성/조회 구현 후 도메인별 repository와 API·배치·권한·감사를 순차 전환. 이번 범위는 Team/Coach 조회 10개. 종료 기준은 모든 사용 경로와 회귀·권한/암호화 검증 완료이며 아직 진행 중이다.
3. 운영 리허설: 실제 source mode 확인, 승인된 shadow 복사, 데이터/화면/성능 동등성, 백업 복원·역동기화/전진 복구. 미실행.
4. 전환: 원본 쓰기 동결, 최종 snapshot/sequence 상한, 데이터 대조, 검토 후 factory·배포 연결. 운영 신규 쓰기 이후 단순 PG 주소 복귀 금지. 미실행.

운영 PG backfill, 전체 환경 복제, 키 변경, 기존 미커밋 파일 변경을 이 조회 작업에 섞지 않는다.

## 2026-09-22 저장소 구현 후속
코치 CRUD·팀 명단 생성/수정·강사노트 저장의 shadow 구현과 Mongo7.0.43 합성검증 완료. 다음 작업 및 남은 gate는 ../mongodb-write-repositories/handoff.md, docs/operations/mongodb-runtime-coverage.md 참고. 전체 runtime/실제복사/전환 Wave는 계속 in_progress.

## 2026-09-22 API 경계 후속
Coach 관리 route·Team facade·Instructor save·요청/개인정보 감사의 명시 Mongo context와 PG 진입 차단 구현. 로컬 Mongo8.0.30 합성 검증 완료. feature 원격 보관 연결 문제 해소. 전체 runtime Wave는 진행 중이며 다음 Task는 코치 토큰/본인/개인정보 export 경계. 최신 증거·gap은 ../mongodb-api-boundaries/handoff.md를 따른다.

## 코치 접근 경계 후속
코치 token/본인조회/export/재발급의 명시Mongo경계와 실제권한/감사검증 완료. 다음 Task는 일정등록/예약/취소. 최신근거 ../mongodb-coach-access/handoff.md. 전체runtime/실제데이터/배포는 진행중.

## 일정·예약 총괄 통합
1601e60의 일정등록/관리조회/예약/본인취소 구현을 총괄feature에 fast-forward 통합하고 전체회귀837pass16skip 재확인했다. 최신검토는 ../mongodb-coach-schedules/integration-review.md. 다음 Task는 engagement 확정/예약자동취소/관련동기화writer의 공통원자성이다. 예약없는시점의확정과신규예약경쟁을 공통guard/재검사로검증하며 기존삭제·확정이력정책을임의로바꾸지않는다. 전체운영이전은진행중.

## 섭외·자동취소 총괄 통합
71ed7d8을 총괄feature에 fast-forward하여 전체848pass17skip 재확인, 별도독립통합검토통과. 최신근거 ../mongodb-coach-engagements/integration-review.md. 다음은 contractSheetSync/samsungScheduleSync의 원천adapter·실제저장경계와 공통guard, 다중코치잠금순서·기존Cascade/SetNull 계약 검증. 전체운영이전은계속진행중.

## 시트 동기화 총괄 통합
47b9ba6을 통합하여 전체864pass18skip0fail 재확인, 독립 통합 검토 통과. 근거는 ../mongodb-coach-sheet-sync/integration-review.md. 다음은 Notion 코치 sync 저장 경계와 catalog 잠금 참여, 실제 sync/all 합성 검증이다. 그 직후 이름을 포함하는 sourceEngagementId/sourceEngagementScheduleId 평문 저장을 암호화 정책·고유키·조회·snapshot/runtime·이전 도구까지 함께 보완한다. 해당 평문은 전체 암호화/운영 전환 차단 항목이며 허용된 제외 범위가 아니다. 이후 runtime-coverage의 미전환 기능을 계속 진행한다.

## Notion 코치 동기화 후속

명시 source/repository와 PG 기본/Mongo adapter, 실제 Notion/all 및 catalog 참여를 구현·검증했다. 일반876pass19skip0fail, Mongo8.0.30 묶음110pass0skip(mock4포함), type/buildpass, lint0error기존7warning. 실행·독립 검증 근거는 ../mongodb-coach-notion-sync/execution-review.md를 따른다. 다음 작업은 이름 포함 sourceEngagementId/sourceEngagementScheduleId의 암호화 정책·검색/고유키·snapshot/runtime·기존변환 보완이며 전체 개인정보 암호화의 필수 차단 항목이다. 이후 남은 runtime 경로·실제복사/복원/전환을 계속 수행한다.

## 원천 식별자 암호화 후속

feature/20260922-source-identifiers-encryption에서 이름 포함 sourceEngagementId/sourceEngagementScheduleId를 암호화 정책·HMAC unique·PG migration·계약 snapshot·Mongo 시트 HMAC 매칭·기존 namespace 거부까지 구현했다. 격리 PG17과 Mongo8.0.30 replica set으로 전환 상태·부분 중단·재시도·키 불일치·재동기화를 검증했다. 근거는 ../mongodb-source-identifiers-encryption/execution-review.md. 운영 migration/backfill은 미실행이다. 다음은 총괄 feature 통합 검토 후 runtime-coverage의 미전환 기능과 실제 복사·복원 리허설이다.

## 원천 식별자 암호화 총괄 통합

b032fc5를 총괄 feature에 fast-forward하고 전체 회귀(일반876pass20skip0fail, Mongo112pass, PG22pass, type/build/lint)를 재확인했다. 근거는 ../mongodb-source-identifiers-encryption/integration-review.md. 다음은 runtime-coverage의 미전환 기능 전환과 운영 backfill·실제 복사·복원 리허설 준비다. 전체 운영 이전은 진행 중이다.

## 코치 태그 마스터·삭제 코치 관리

feature/20260923-mongodb-coach-master-restore에서 태그 마스터·삭제 코치 목록/복원/영구삭제의 Mongo 경계를 구현했다. 영구삭제는 결정권자 결정으로 기존 물리 삭제와 동일하게 유지한다. 근거는 ../mongodb-coach-admin/execution-review.md. 다음은 코치 메모·콘텐츠·관리 조회 등 남은 coverage 기능군이다.
