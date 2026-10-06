# 실행 명령과 로그 연결

cwd: `/Users/ga/workspace/hub-om-mongodb-coach-content`. 모든 실행은 `env -i HOME=/Users/ga TZ=UTC LC_ALL=C PATH=/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/bin:/bin`의 깨끗한 환경이다. 비밀값은 상속/기록하지 않았으며 fixture가 임시 key를 생성했다. 원시 로그·소스 해시는 execution-manifest의 durable evidence에 있다. 아래 DB 주소는 이미 정리한 소유 합성 주소이며 새 실행 전에 같은 자원이라고 가정하지 않는다.

| 검사 | 실행 entry와 명시 환경 | 최종 로그 |
| --- | --- | --- |
| 일반 | `npm test` | unit-final.log |
| 타입 | `npm run typecheck` | typecheck-page-final.log |
| lint | `npm run lint` | lint-final.log |
| build | `npm run build` | build-final.log |
| native + scope | `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/mongoDriveImportHistory.integration.test.ts src/lib/data/driveImportHistoryScope.test.ts`; `MONGODB_DRIVE_HISTORY_TEST_URI=mongodb://127.0.0.1:27850/?replicaSet=drivehistory20260930` | native-final.log |
| page | 같은 node flags, `--test src/lib/data/driveImportHistoryPage.test.ts`; 아래 환경으로 original-pg→current-pg→native 순차 | page-{original-pg,current-pg,native}-accepted.log |
| parity | original/PARITY-RUN.txt의 endpoint/flags + `--test-name-pattern='Drive independent literal parity'` | parity-gap-fixed.log |
| PG gate | original/PG-GATE-RUN.txt | pg-gate-extended.log |
| Calendar | durable calendar-endpoint-hook.mjs로 exact 단일 URI 리터럴 치환, actual handler/scope 테스트 | calendar-context-regression.log |

Page 환경: `DRIVE_HISTORY_PAGE_BACKEND`를 각 backend로 지정하고 `PG_DRIVE_HISTORY_TEST_DATABASE_URL=postgresql://synthetic@127.0.0.1:56750/drive_history_test`, `PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY=/private/tmp/hub-om-drive-import-history-20260930/pg`, 위 Mongo URI를 지정했다. 제품 source/단언 변경 없이 실행했다. 원본 frozen loader/closure는 변경하지 않았다.

Calendar 치환은 calendar-endpoint-only.diff와 calendar-endpoint-evidence.json의 원본해시/정확1회 조건으로 검증했다. 합성 endpoint 이외 변경0이며 해당 테스트 전체24를 확인했다. 실제 서버 shutdown/PG stop은 cleanup-audit.log, pg-stop.log, cleanup-final.json에 별도 기록했다.

각 최종 명령 exit0은 부모 tool 결과로 확인했다. 첫 실패 로그도 보존하며 실행 중간 pass 개수만으로 wrapper 성공을 대체하지 않았다.
