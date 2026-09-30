# 실행 증거 목록

기준: 093f585b444197c6b0442a3880469fd0d6a0502b. 브랜치: feature/20260930-mongodb-notion-import.

Durable root: `/Users/ga/.cache/hub-om-verification/20260930-notion-import`.

- 증거30파일: `sha256.json`, SHA256 `1085f7c7368c62af44590a513904e5f95d3d97794de0b8ab18aac897318cda5b`.
- 최종 source1063파일: `source-final.json`, SHA256 `36239dc97ba736170b5148d93d69f9ae8f690153c65340a445d88cd28988be08`.
- 제품3파일: `product-digests.json`; 검사 후 변경0.
- frozen 기준검증: `frozen-source-check.json`;77파일 mismatch0.
- 이전Sheets source1050/증거45 재사용 대조: `reuse-source-check.json`.
- 전체 ledger: `parity-final-ledgers.json`, 원문 `logs/parity-fixed.log`; 이전 보완 전 로그도 보존.
- 정리: `cleanup-final.json`, `logs/resource-audit.log`. 로그에는 합성값만 포함.

`source-initial-checks.json`은 첫 일반검사 이후 수집한 중간 snapshot이며 모든 검사 이전 공통 snapshot이 아니다. `source-delta.json`은 그 시점 이후 기존파일 차이만 기록한다. 전체 수정 범위는 handler2파일 및 parity worker/isolation/신규Ids fixture5파일이고, 최종1063 source 목록과 각 재실행을 연결한다. 최종 문서·원격 SHA 증거는 별도 후속이며 source hash에 포함하지 않는다.

## 재현 명령

아래 명령은 격리 clone에서 실행했다. 공통 prefix는 `env -i HOME=/Users/ga LC_ALL=C PATH=/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/bin:/bin`이다. 임시 DB는 이미 정리되어 그대로 재실행하면 안 되며 새 소유 환경을 먼저 준비해야 한다.

- `npm test` → general.log.
- `npm run typecheck`, `npm run lint`, `npm run build` → 대응 로그. test 수정 후 typecheck/lint만 최종 재실행.
- `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/notionImportSource.test.ts` → source-http.log.
- `TZ=UTC MONGODB_NOTION_IMPORT_TEST_URI=mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930 node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/notionImportHandlers.integration.test.ts` → handlers-fixed.log.
- `NODE_ENV=test MONGODB_NOTION_IMPORT_TEST_URI=mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930 node --experimental-test-module-mocks --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-concurrency=1 src/lib/data/notionImportTransactions.integration.test.ts` → transactions.log.
- 원본 PG gate: `NODE_ENV=test PG_NOTION_TEST_DATABASE_URL=postgresql://synthetic@127.0.0.1:56752/notion_import_test PG_NOTION_TEST_DATA_DIRECTORY=/private/tmp/hub-om-notion-import-20260930/pg node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-name-pattern='Notion frozen original PG observation gate' src/lib/data/notionImport.postgres.integration.test.ts`. 최종parity는 `original/PARITY-RUN.txt`의 NOTION_IMPORT_PARITY=1 명령이다.
- `node /private/tmp/hub-om-notion-import-20260930/audit-resources.mjs` → resource-audit.log.

권한/실원천/비밀값이 필요한 명령은 실행하지 않았다. 셸에서는 URL 인자를 따옴표로 감쌌다. 모든 최종 검사 exit0, 최초 handler exit1은 숨기지 않고 보존한다.
