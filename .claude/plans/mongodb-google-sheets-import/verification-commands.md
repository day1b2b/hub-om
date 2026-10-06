# 실행 명령과 증거

cwd `/Users/ga/workspace/hub-om-mongodb-coach-content`. 공통 `env -i HOME=/Users/ga LC_ALL=C PATH=/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/bin:/bin`. fixture가 임시 키를 생성하며 운영 env는 읽지 않는다. 일반 검사만 TZ=UTC를 사용했고 handler는 inherited TZ를 거부하므로 제외했다.

- 일반: `npm test`, 타입: `npm run typecheck`, lint: `npm run lint`, build: `npm run build`.
- HTTP/handler: `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/googleSheetsImportSource.test.ts src/lib/data/googleSheetsImportHandlers.integration.test.ts`. 최종 handler 지역변수 수정 후 handler 파일만 재실행했다.
- transaction: 같은 flags의 `--test --test-concurrency=1 src/lib/data/googleSheetsImportTransactions.integration.test.ts`, `NODE_ENV=test`.
- handler/transaction 환경: `MONGODB_SHEETS_IMPORT_TEST_URI=mongodb://127.0.0.1:27851/?replicaSet=sheetsimport20260930`.
- parity: `NODE_ENV=test SHEETS_IMPORT_PARITY=1`, `node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test .claude/plans/mongodb-google-sheets-import/original/parity-runner.fixture.ts`. PG 환경은 아래, Mongo는 별도 이름 `MONGODB_SHEETS_TEST_URI`에 같은 URI다.
- PG gate: `NODE_ENV=test`, `node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-name-pattern='Sheets frozen original PG observation gate' src/lib/data/googleSheetsImport.postgres.integration.test.ts`.
- PG 환경: `PG_SHEETS_TEST_DATABASE_URL=postgresql://synthetic@127.0.0.1:56751/sheets_import_test`, `PG_SHEETS_TEST_DATA_DIRECTORY=/private/tmp/hub-om-google-sheets-import-20260930/pg`.
- Calendar: 기본 test flags에 durable `calendar-endpoint-hook.mjs`를 --import로 추가, `MONGODB_CALENDAR_TEST_URI`에 위 Mongo URI를 지정하여 mongoCalendarHandlers.integration.test.ts/calendarRepositoryScope.test.ts를 실행했다. 원본 exact URI 한 곳 치환만 허용한다.

로그 경로·건수·exit는 execution-manifest.json. 위 주소는 이 작업 소유 합성 자원에만 해당한다. 정리 뒤 재실행하려면 신규 소유권·dbpath·port를 먼저 확인해야 한다. 과거 PID/DB라고 임의 삭제하지 않는다.
