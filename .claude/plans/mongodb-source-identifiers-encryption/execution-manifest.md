# Execution Manifest

기준 14cbf142bc39ebc6dfa0a0d9aa5cd65adef5c319(총괄 feature/20260922-mongodb-parallel-transition). 작업 브랜치 feature/20260922-source-identifiers-encryption, scratchpad 별도 clone. 시작 시 미커밋 변경 없음.

## 기존 파일 변경
- `prisma/schema.prisma`: 두 `*PiiIndex` companion과 unique
- `src/lib/privacy/fields.json`, `src/lib/privacy/inventory.json`: 두 필드를 encrypted로 분류(26테이블/127필드)
- `src/lib/activity/field-policy.json`: companion 컬럼 changeOnly
- `src/lib/data/mongoRuntimeContracts.json`: migration 계약에서 재생성(companion 2개, unique 대상 HMAC)
- `src/lib/data/mongoCoachSheetSyncRepository.ts`: HMAC 조회 후 원문 확인
- `src/lib/data/mongoOperationStore.ts`, `src/lib/data/mongoReadStore.ts`: `applyMongoValidator`로 이전 정책 문서 거부·경합 시 validator 복원
- `src/lib/data/mongoCoachSheetSyncRepository.integration.test.ts`: 신규 subtest 2개, CoachEngagement 이름 평문 예외 제거
- `src/lib/data/mongoRuntimeCodec.test.ts`, `src/lib/migration/mongoDocumentCodec.test.ts`: 개인정보 필드 수 127
- `docs/operations/personal-data-encryption.md`, `mongodb-coach-sheet-sync.md`, `mongodb-shadow-transfer.md`, `mongodb-runtime-coverage.md`
- `.claude/plans/mongodb-read-repositories/macro-plan.md`

## 신규 파일
- `prisma/migrations/20260923090000_pii_source_engagement_ids/migration.sql` (운영 미적용)
- `src/lib/privacy/sourceEngagementIds.integration.test.ts` (`PII_SOURCE_ID_TEST_DATABASE_URL`, 127.0.0.1/pii_source_ids_test 전용)
- `docs/operations/pii-source-engagement-ids.md`
- `.claude/plans/mongodb-source-identifiers-encryption/{execution-manifest,execution-review,handoff}.md`

## 자동으로 따라온 경로(코드 변경 없음, 검증함)
- Prisma privacy wrapper equality/`in`/findUnique/upsert → HMAC, `createMany` 암호화
- `scripts/encrypt-personal-data.ts` backfill·enforce CHECK
- migration/runtime codec, 35모델 exporter/importer, Mongo validator·unique/HMAC index, Mongo 감사 redaction
- 직접 SQL CLI는 기존 `assertLegacyStorage`로 암호화 스키마에서 거부

## 실행 환경
Node 24.19.0 절대 경로 + `env -i`. PostgreSQL 17.9(Homebrew) scratchpad dbpath, 127.0.0.1:55433→55439. MongoDB 8.0.30 공식 tarball(sha256 일치) scratchpad dbpath, 127.0.0.1:27961 replica set rs0. 합성 데이터·임시 키만 사용. 로그는 scratchpad `final-*.log`.
