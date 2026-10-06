# Execution Manifest

기준 d813eac(총괄 feature/20260922-mongodb-parallel-transition). 작업 브랜치 feature/20260923-mongodb-coach-master-restore, scratchpad 별도 clone. 시작 시 미커밋 변경 없음.

## 결정
- 영구삭제(물리 삭제)는 2026-09-23 결정권자 결정으로 Mongo에도 기존과 같이 유지. 새 삭제 정책 추가 없음.

## 기존 파일 변경
- `src/app/api/master/fields/route.ts`, `src/app/api/master/curriculums/route.ts`, `src/app/api/admin/deleted-coaches/route.ts`: 저장소 호출로 전환(응답·오류·인증 불변)
- `src/lib/data/dataRepositoryContext.ts`: `coachAdmin` 추가
- `src/lib/data/mongoRequestAuditRepository.ts`, `src/lib/data/mongoCoachExportRepository.ts`: 접근 기록 저장이 코치 잠금 참여, 11000 재시도, recordAccess 제한시간 30초
- `docs/operations/mongodb-runtime-coverage.md`, `.claude/plans/mongodb-read-repositories/macro-plan.md`

## 신규 파일
- `src/lib/data/coachAdminRepository.ts`, `prismaCoachAdminRepository.ts`(기존 쿼리 그대로), `coachAdminRepositoryFactory.ts`, `mongoCoachAdminRepository.ts`
- `src/lib/data/coachAdminPurgeFixture.ts`(PG·Mongo 공용 합성 fixture)
- `src/lib/data/mongoCoachAdminRepository.integration.test.ts`(`MONGODB_COACH_ADMIN_TEST_URI`)
- `src/lib/data/prismaCoachAdminRepository.integration.test.ts`(`COACH_ADMIN_PG_TEST_DATABASE_URL`, 127.0.0.1/coach_admin_test)
- `docs/operations/mongodb-coach-admin.md`
- `.claude/plans/mongodb-coach-admin/{execution-manifest,execution-review,handoff}.md`

## 실행 환경
Node 24.19.0 절대 경로 + `env -i`. PostgreSQL 17.9 scratchpad dbpath 127.0.0.1:55439. MongoDB 8.0.30 공식 tarball(sha256 일치) 127.0.0.1:27961 replica set. 합성 데이터·임시 키만 사용.
