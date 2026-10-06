# Execution Manifest

기준 f3e80fe94a580a675da2b17c92b6ea463080a72c. 별도clone feature/20260922-mongodb-coach-sheet-sync. 시작 변경 없음, 아래는 이번 작업만이다.

## 기존 파일 변경
- `docs/operations/mongodb-runtime-coverage.md`
- `src/lib/coaches/contractSheetSync.ts`
- `src/lib/coaches/notionCoachSync.ts`
- `src/lib/coaches/samsungScheduleSync.ts`
- `src/lib/coaches/syncLog.ts`
- `src/lib/data/dataRepositoryContext.ts`
- `src/lib/data/mongoCoachEngagementRepository.integration.test.ts`
- `src/lib/data/mongoCoachEngagementRepository.ts`
- `src/lib/data/mongoCoachManagementRepository.ts`
- `src/lib/data/mongoCoachWriteRepository.test.ts`
- `src/lib/data/mongoCoachWriteRepository.ts`
- `src/lib/data/prismaCoachEngagementRepository.test.ts`
- `src/lib/data/prismaCoachEngagementRepository.ts`
- `src/lib/data/prismaCoachLock.ts`
- `src/lib/data/prismaCoachManagementRepository.ts`

## 신규 파일
- `.claude/plans/mongodb-coach-sheet-sync/alignment-review.md`
- `.claude/plans/mongodb-coach-sheet-sync/clarify-result.md`
- `.claude/plans/mongodb-coach-sheet-sync/execution-manifest.md`
- `.claude/plans/mongodb-coach-sheet-sync/execution-review.md`
- `.claude/plans/mongodb-coach-sheet-sync/gap-plan.md`
- `.claude/plans/mongodb-coach-sheet-sync/handoff.md`
- `.claude/plans/mongodb-coach-sheet-sync/meta-evaluation.md`
- `.claude/plans/mongodb-coach-sheet-sync/plan-v1-review.md`
- `.claude/plans/mongodb-coach-sheet-sync/plan-v1.md`
- `.claude/plans/mongodb-coach-sheet-sync/plan-v2.md`
- `.claude/plans/mongodb-coach-sheet-sync/validation-v1.md`
- `.claude/plans/mongodb-coach-sheet-sync/validation-v2.md`
- `docs/operations/mongodb-coach-sheet-sync.md`
- `src/lib/coaches/coachSheetSource.test.ts`
- `src/lib/coaches/coachSheetSyncWorkflow.test.ts`
- `src/lib/coaches/coachSheetSyncWorkflow.ts`
- `src/lib/data/coachSheetSyncRepository.ts`
- `src/lib/data/coachSheetSyncRepositoryFactory.ts`
- `src/lib/data/coachSyncLogRepository.ts`
- `src/lib/data/coachSyncLogRepositoryFactory.ts`
- `src/lib/data/mongoCoachCatalogGuard.ts`
- `src/lib/data/mongoCoachSheetSyncRepository.integration.test.ts`
- `src/lib/data/mongoCoachSheetSyncRepository.ts`
- `src/lib/data/mongoCoachSyncLogRepository.ts`
- `src/lib/data/prismaCoachSheetSyncRepository.test.ts`
- `src/lib/data/prismaCoachSheetSyncRepository.ts`

## Plan v2 매핑
1 workflow/source: coachSheetSyncWorkflow.ts, 두 sync facade/source tests — 완료.
2 coordination: catalog/coach guard 및 양backend management/manual 참여 — 완료.
3 정책/FK: shared workflow/양adapter, cross-coach 참조 — 완료.
4 저장경계: repo/log factories/context, Notion 진입차단 — 완료.
5 검증: 일반864pass18skip, native87pass0skip(mock4포함), type/buildpass, lint0error기존7warning 및 독립V1–V9 PASS — 완료.
6 문서/정리: coverage/운영문서/artifacts, 합성DB0·ownedreplica종료 — 완료. feature commit/push의 SHA는 최종 인계 메시지 참조.

Node24.19 env-i/owned Mongo8.0.30; 로그 `/tmp/hub-om-sheet-{tests,native-all,typecheck,lint,build}.log`. 검증 세부·범위 제한은 execution-review.md에 기록했다.
