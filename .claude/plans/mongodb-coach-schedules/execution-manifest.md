# Execution manifest

기준 cc9eeb49e3e6792c560b9c448527d2069e9603a8. clean isolated clone, 기존사용자변경없음. 작업 branch feature/20260922-mongodb-coach-schedules.

## Plan mapping
1 계약/날짜검증: coachScheduleRepository.ts, coachScheduleValidation.ts, 세route.
2 저장소/원자성: Mongo/PrismaCoachScheduleRepository, context/factory, mongoOperationAudit.
3 API연결: 세route. 기존 auth 및 production PG기본유지.
4 검증: 순수validation6, PGmock6, actualhandlerMongo native(최종기록아래).
5 문서/독립리뷰/feature보관: 이디렉토리, mongodb-coach-schedules.md, runtime coverage.

## 실제 실행
실행은 Node24.19.0이며 env -i HOME=/Users/ga PATH=<bundled node>/bin:/opt/homebrew/bin:/usr/bin:/bin 로정리했다. env파일없음. generated Prisma만 fake localhost DATABASE_URL 사용(접속없음). native 테스트는 random DB/namespace/PII키로실행하며finally DB삭제.
- npm ci --ignore-scripts --no-audit --no-fund: 기존lock530패키지설치,의존성변경없음.
- npm run db:generate: 통과, 가짜postgresql://synthetic:synthetic@127.0.0.1:1/synthetic.
- npm test: 853 tests / 837 pass / 0 fail / 16 skip. URI미설정native/PG integration skip포함. /tmp/hub-om-coach-schedules-tests.log.
- npm run typecheck: exit0. /tmp/hub-om-coach-schedules-typecheck.log.
- npm run lint: exit0,기존7warning/0error. /tmp/hub-om-coach-schedules-lint.log.
- npm run build: exit0. /tmp/hub-om-coach-schedules-build.log.
- git diff --check: 통과.
- Native MongoDB 8.0.30 replica set 최종묶음: 47 tests / 47 pass / 0 fail / 0 skip,29.85초. 이중기존TeamMember mock4개포함이며837pass와합산하지않음. /tmp/hub-om-coach-schedules-native-all.log.
- 신규 actual schedule/reservation handler: 13 subtests + parent =14/14pass/0skip(단독실행13.76초, 전체묶음에서도통과).
- env -i 위PATH/HOME + MONGODB_{RUNTIME,COACH,COACH_WRITE,INSTRUCTOR_NOTE,TEAM_USER,API_CONTEXT,COACH_ACCESS,COACH_SCHEDULE}_TEST_URI=mongodb://127.0.0.1:27942/?replicaSet=scheduleTest node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/mongo*.integration.test.ts src/lib/data/teamUsers/mongo*.integration.test.ts src/lib/data/mongoTeamMemberRepository.test.ts
- 전체묶음 실행helper /tmp/hub-om-coach-schedules-run-native.py는glob을실제파일목록으로확장한다. URI는오직이작업이시작한loopback replica set.
- 최종테스트파일 ESLint/tsc --noEmit --incremental false/diffcheck exit0 (테스트작성자별도실행).

- native buildInfo 8.0.30, 종료 전 remainingSyntheticDatabases=[] 확인.

## 변경파일
- `.claude/plans/mongodb-coach-schedules/alignment-review.md`
- `.claude/plans/mongodb-coach-schedules/clarify-result.md`
- `.claude/plans/mongodb-coach-schedules/execution-manifest.md`
- `.claude/plans/mongodb-coach-schedules/execution-review.md`
- `.claude/plans/mongodb-coach-schedules/gap-plan.md`
- `.claude/plans/mongodb-coach-schedules/handoff.md`
- `.claude/plans/mongodb-coach-schedules/meta-evaluation.md`
- `.claude/plans/mongodb-coach-schedules/plan-v1-review.md`
- `.claude/plans/mongodb-coach-schedules/plan-v1.md`
- `.claude/plans/mongodb-coach-schedules/plan-v2.md`
- `.claude/plans/mongodb-coach-schedules/validation-v1.md`
- `.claude/plans/mongodb-coach-schedules/validation-v2.md`
- `docs/operations/mongodb-coach-schedules.md`
- `docs/operations/mongodb-runtime-coverage.md`
- `src/app/api/coach/schedule/[yearMonth]/route.ts`
- `src/app/api/coaches/[id]/reservations/route.ts`
- `src/app/api/coaches/[id]/schedules/route.ts`
- `src/lib/coaches/coachScheduleValidation.test.ts`
- `src/lib/coaches/coachScheduleValidation.ts`
- `src/lib/data/coachScheduleRepository.ts`
- `src/lib/data/coachScheduleRepositoryFactory.ts`
- `src/lib/data/dataRepositoryContext.ts`
- `src/lib/data/mongoCoachScheduleRepository.integration.test.ts`
- `src/lib/data/mongoCoachScheduleRepository.ts`
- `src/lib/data/mongoOperationAudit.ts`
- `src/lib/data/prismaCoachScheduleRepository.test.ts`
- `src/lib/data/prismaCoachScheduleRepository.ts`
