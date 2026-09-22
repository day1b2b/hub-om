# Execution manifest

기준 7ebb24f221b60d9180e7bbe8b82dd83120f49f79, clean isolated checkout /tmp/hub-om-coach-schedules-20260922, branch feature/20260922-mongodb-coach-engagements. 기존사용자변경 없음.

## Plan mapping
1 계약: coachEngagementRepository DTO/pure engagementApi/3routes.
2 직렬화: mongoCoachSchedulingGuard/prismaCoachLock 및 양 schedule/engagement adapter.
3 원자성: engagement/slots/자동취소/ActivityChange/reviewContent transaction.
4 경계: factory/context/기존PG기본, 외부sync와호환helper는후속유지.
5 검증/검토/기록/feature보관: 아래 실행과 이디렉토리.

## 실행 환경과 검증
Node24.19.0. env -i HOME=/Users/ga PATH=/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/bin:/bin 사용. env파일 없으며 운영키/DB사용 없음.
- npm test:865tests/848pass/0fail/17skip. /tmp/hub-om-engagement-tests.log. URI미설정integration은skip이며native별도실행과합산하지않는다.
- npm run typecheck:exit0. /tmp/hub-om-engagement-typecheck.log.
- npm run lint:exit0,기존7warning/0error. /tmp/hub-om-engagement-lint.log.
- npm run build:exit0. /tmp/hub-om-engagement-build.log.
- git diff --check:통과.
- 작성자 단위검증:pure5/PGengagementmock6/기존PGschedulemock6 통과. mock은실PG경합/rollback증거가아니다.
- 신규 actualhandler 최종17/17pass/0skip(단독18.34초), V4/V5강제경합·재조회 포함.
- 전체 Mongo native 묶음64/64pass/0skip/0fail,47.62초. 기존 TeamMember mock4개 포함. /tmp/hub-om-engagement-native-all.log. 전체848pass와합산하지않는다.
- 실행: /tmp/hub-om-engagement-run-native.py. env -i 위HOME/PATH + MONGODB_{RUNTIME,COACH,COACH_WRITE,INSTRUCTOR_NOTE,TEAM_USER,API_CONTEXT,COACH_ACCESS,COACH_SCHEDULE,COACH_ENGAGEMENT}_TEST_URI=mongodb://127.0.0.1:27943/?replicaSet=engagementTest. node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/mongo*.integration.test.ts src/lib/data/teamUsers/mongo*.integration.test.ts src/lib/data/mongoTeamMemberRepository.test.ts (helper가glob을실제파일목록으로확장).
- buildInfo MongoDB8.0.30 및 remainingSyntheticDatabases=[] 직접확인.
- 최종테스트파일 ESLint·전체 tsc --noEmit --incremental false·diff check exit0(작성자 별도실행).

## 변경파일
- `.claude/plans/mongodb-coach-engagements/alignment-review.md`
- `.claude/plans/mongodb-coach-engagements/clarify-result.md`
- `.claude/plans/mongodb-coach-engagements/execution-manifest.md`
- `.claude/plans/mongodb-coach-engagements/execution-review.md`
- `.claude/plans/mongodb-coach-engagements/gap-plan.md`
- `.claude/plans/mongodb-coach-engagements/handoff.md`
- `.claude/plans/mongodb-coach-engagements/meta-evaluation.md`
- `.claude/plans/mongodb-coach-engagements/plan-v1-review.md`
- `.claude/plans/mongodb-coach-engagements/plan-v1.md`
- `.claude/plans/mongodb-coach-engagements/plan-v2.md`
- `.claude/plans/mongodb-coach-engagements/validation-v1.md`
- `.claude/plans/mongodb-coach-engagements/validation-v2.md`
- `docs/operations/mongodb-coach-engagements.md`
- `docs/operations/mongodb-coach-schedules.md`
- `docs/operations/mongodb-runtime-coverage.md`
- `src/app/api/coaches/[id]/engagements/route.ts`
- `src/app/api/engagements/[id]/review/route.ts`
- `src/app/api/engagements/[id]/route.ts`
- `src/lib/coaches/engagementApi.test.ts`
- `src/lib/coaches/engagementApi.ts`
- `src/lib/data/coachEngagementRepository.ts`
- `src/lib/data/coachEngagementRepositoryFactory.ts`
- `src/lib/data/dataRepositoryContext.ts`
- `src/lib/data/mongoCoachEngagementRepository.integration.test.ts`
- `src/lib/data/mongoCoachEngagementRepository.ts`
- `src/lib/data/mongoCoachScheduleRepository.ts`
- `src/lib/data/mongoCoachSchedulingGuard.ts`
- `src/lib/data/mongoOperationAudit.ts`
- `src/lib/data/prismaCoachEngagementRepository.test.ts`
- `src/lib/data/prismaCoachEngagementRepository.ts`
- `src/lib/data/prismaCoachLock.ts`
- `src/lib/data/prismaCoachScheduleRepository.test.ts`
- `src/lib/data/prismaCoachScheduleRepository.ts`
