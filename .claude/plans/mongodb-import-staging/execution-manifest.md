# 실행 매니페스트

기준 8e19638881581593a8c79660892ddbab364d1d25에서 깨끗한 별도 clone/작업 branch로 시작했다. 기존 사용자 변경 없음. 다음 파일은 이번 작업 소유다. V1~V8은 독립 수락했다. V9 전체회귀 실패 보완·정리·통합은 진행 중이다.

## 추적 파일 변경

- `src/lib/data/mongoOmAssignmentConcurrency.integration.test.ts`, `src/lib/data/mongoOmAssignmentHandlers.integration.test.ts`: 기존 업무 검사 변경 없이 새 소유 합성 endpoint의 정확한 allowlist 및 실제 replica명 확인 추가. 이전 주소 고정으로 회귀 실행이 막힌 문제 보완.
- `docs/operations/mongodb-runtime-coverage.md`, `mongodb-cutover-remaining.md`, 새 `mongodb-import-staging.md`: 경계 및 남은 작업 갱신.

- `src/app/admin/imports/[id]/page.tsx`
- `src/app/admin/imports/page.tsx`
- `src/app/api/admin/imports/upload/route.ts`
- `src/lib/data/dataRepositoryContext.ts`
- `src/lib/data/importStagingWriter.ts`
- `src/lib/data/prismaImportRepository.ts`

## 새 파일

- `.claude/plans/mongodb-import-staging/clarify-result.md`
- `.claude/plans/mongodb-import-staging/execution-review.md`
- `.claude/plans/mongodb-import-staging/handoff.md`
- `.claude/plans/mongodb-import-staging/meta-evaluation.md`
- `.claude/plans/mongodb-import-staging/original-digests.json`
- `.claude/plans/mongodb-import-staging/plan-v1-review.md`
- `.claude/plans/mongodb-import-staging/plan-v1.md`
- `.claude/plans/mongodb-import-staging/plan-v2.md`
- `.claude/plans/mongodb-import-staging/validation-v1.md`
- `.claude/plans/mongodb-import-staging/validation-v2.md`
- `src/lib/data/importReadOriginal.fixture.ts`
- `src/lib/data/importRepositoryFactory.ts`
- `src/lib/data/importReviewPresenter.ts`
- `src/lib/data/importStaging.postgres.integration.test.ts`
- `src/lib/data/importStagingOriginal.fixture.ts`
- `src/lib/data/importStagingValidation.ts`
- `src/lib/data/mongoImportRepository.integration.test.ts`
- `src/lib/data/mongoImportRepository.ts`
- `src/lib/data/mongoImportStagingHandlers.integration.test.ts`

## 계획 매핑

- Step1: context/factory/facade/pages 및 원본 reader/writer 동결 — 구현완료.
- Step2: importStagingValidation 및 기본PG추출 — 구현완료, 실제3방향 oracle 실행중.
- Step3~5: mongoImportRepository 인증검색/transaction/목록·상세 — 구현완료, native 실패·경합·한계 검증중.
- Step6: importReviewPresenter — 구현완료, 원본PG DTO대조.
- Step7: upload 고정오류 허용목록 — 구현완료, actual handler15PASS; 타입보완후 전체회귀예정.
- Step8: PG18/native30/handler16, 일반921·68skip/type/lint/build 및 독립 V1~V8 수락. 전체Mongo 실패3파일 재검증103pass 완료, 파일별최종751성공.
- Step9: 문서/독립수락/정리 완료, 원격통합 대기.
