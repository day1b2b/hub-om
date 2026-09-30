# Drive writer 실행 증거

기준 3c72e6997e057b7811e128e12ca6b354065de66a, 작업 feature/20260930-mongodb-drive-import-writer. Node24.19.0, PG17.9, Mongo8.0.30. 운영·실원천·실env는 사용하지 않았다.

Durable root: `/Users/ga/.cache/hub-om-verification/20260930-drive-import-writer`.

- source1095: source-final.json, SHA256 `c03dda667d4934157288fb0ee6eac12eb762a99f567688ee006b554c64fb6b31`.
- 증거60파일: sha256.json, SHA256 `a193e817b3ebf63e8a63704d54dbf03f882d8080a72304a2959c0c455d86386b`.
- 제품8파일: product-digests.json. source hash에 최종 서술 문서와 원격 SHA 후속 기록은 포함하지 않는다.
- 이전 Notion source1063 중 차이는 CLI/context2개뿐이고, 증거30파일은 모두 일치: reuse-source-check.json. 기존 codec/정책/schema/history/Calendar 구현은 동일하며 새 writer 연결은 별도 실제 검증했다.
- source-before-general.json과 source-after-general-delta.json: 일반검사 이후 변경은 opt-in 검증 fixture/실행 안내뿐이다. 해당 native/parity를 다시 실행하고 최종 typecheck/lint를 완료했다. 제품 런타임·일반 실행 테스트·빌드는 재변경하지 않았다.
- native-typefix-equivalence.json: CollectionInfo 타입 표기 전후 emitted JS 일치. V3 이후 기능 변경이 아니다.
- 원본 독립성은 original/closure-manifest.json 53개와 immutable git object 해석기로 검증한다. original/gate-digests.json은 작성 시점 스냅숏이며 최종 실행 소스 증거는 위 source-final을 사용한다.
- 원본 gate 관찰4개, 최종 parity JSON6개, 실패·성공 로그, cleanup-final/resources-before-cleanup을 모두 보존했다.

## 실제 명령과 결과

공통 prefix: `env -i HOME=/Users/ga LC_ALL=C PATH=/Users/ga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/opt/homebrew/bin:/usr/bin:/bin`.

| 검증 | 공통 prefix 뒤 명령/설정 | 최종 로그 | 결과 |
| --- | --- | --- | --- |
| 일반 | `npm test` | general.log | 1034 PASS/93 opt-in skip/0fail |
| 타입 | `npm run typecheck` | typecheck-verified.log | exit0 |
| lint | `npm run lint` | lint-verified.log | 오류0/기존경고7, exit0 |
| build | `npm run build` | build.log | exit0 |
| scope | `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/driveImportWriterScope.test.ts` | scope-fixed.log | 11 PASS/0skip |
| 실제 CLI entry | `node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/driveImportWriterCli.test.ts` | cli-fixed.log | 6 PASS/0skip |
| 실제 HTTP→native | `TZ=UTC MONGODB_DRIVE_IMPORT_WRITER_SOURCE_TEST_URI='mongodb://127.0.0.1:27853/?replicaSet=drivewriter20260930' node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test src/lib/data/driveImportWriterSource.integration.test.ts` | source-http-final.log | 12 PASS(root+11)/0skip |
| native | `NODE_ENV=test TZ=UTC MONGODB_DRIVE_IMPORT_WRITER_TEST_URI='mongodb://127.0.0.1:27853/?replicaSet=drivewriter20260930' node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test --test-concurrency=1 src/lib/data/driveImportWriterTransactions.integration.test.ts` | transactions-fixed.log | 45 PASS/0skip |
| 원본 gate | `NODE_ENV=test TZ=UTC PG_DRIVE_WRITER_GATE=1 node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-name-pattern='immutable original PG technical gates' src/lib/data/driveImportWriter.postgres.integration.test.ts` | pg-gate-fixed.log | root1 PASS/0skip |
| 최종 parity | `NODE_ENV=test TZ=UTC DRIVE_IMPORT_WRITER_PARITY=1 node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-name-pattern='full immutable legacy/current/native parity' src/lib/data/driveImportWriter.postgres.integration.test.ts` | parity-verified.log | root1 PASS/0skip, 3backend×2TZ 각각22 ledger |

묶음별 결과를 합산하지 않는다. scope/CLI는 일반에 포함한다. 전체 역사 Mongo 묶음 재실행을 주장하지 않는다. 기술 gate와 parity는 서로 다른 증거다. source-port fixture parity는 실제 HTTP V3를 대체하지 않는다.

합성 DB는 최종 정리했으므로 위 endpoint를 그대로 재실행하면 안 된다. 새 소유 환경·원문 migration prefix·임시 키를 먼저 준비해야 한다. setup.sh/apply-prefixes.mjs와 original 실행 안내는 과거 실행 증거이며 운영 적용 명령이 아니다.
