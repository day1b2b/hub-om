# Health 실행 기록

기준35104776c1ae4f42696d06e0e836ead29a786fb3, 격리 clone, 작업 branch feature/20260930-mongodb-health-boundary. 초기 기록 시점에는 구현·검증 진행 중이었다. 최종 상태는 말미를 따른다.

## 환경과 소유 자원

Node24.19.0, PG17.9, Mongo8.0.30. env-i에 상응하는 명시 환경만 전달하며 운영 env를 읽지 않는다. 새 root /private/tmp/hub-om-health-20260930, PG56754/health_test(빈 DB), Mongo27854/health20260930 replica. Mongo는 검증 전용 failpoint를 위해 enableTestCommands를 사용하며 운영 설정과 무관하다. 임시 암호화키는 실행 때 생성하여 로그/문서에 저장하지 않는다.

초기 PG 기동은 LC_ALL 누락으로 macOS locale 오류가 났다. 로그의 원인 확인 후 LC_ALL=C로 같은 소유 cluster를 정상 기동했다. 제품 실패가 아니며 pg.log에 원본 기록을 보존한다.

## 구현

DatabaseHealthRepository.check 포트, PG 기본 factory/context, PG SELECT1, explicit borrowed Mongo ping1(5초 CSOT), 실제 GET 연결. 공개 오류는 모든 환경에서 Health check failed로 고정한다. 생산 성공/실패 응답은 유지하고 개발 상세 오류만 의도적으로 제거한다.

## 초기 검증 상태

초기 typecheck exit0. 최종 기능·일반검사·독립 실행 검토·정리·통합은 아직 미완료. 로그 root/logs, 정책/loader/schema/package 변경 여부는 root/unchanged-baseline.json에 기록했다.

## 범위 제한

빈 PG SELECT1과 미생성 Mongo DB ping은 연결 상태만 검증한다. 유효 형식의 틀린 암호화키, schema 준비, 쓰기 가능성, 데이터 복호화, 백업/복구/운영전환을 보증하지 않는다. main/dev와 생산 backend는 변경하지 않았다.

## 최종 상태

일반1045PASS/95 opt-in skip/0FAIL(health scope root+10개는 부분집합), actualMongo9PASS/0skip(root+8), originalPG gate1PASS/0skip(6사례×원본/current 12관찰), typecheck-final/build PASS, lint 오류0·기존경고7. 서로 다른 단위를 합산하지 않는다. 전체 역사 Mongo 묶음을 새로 실행한 것은 아니다. 빌드 후 제품6파일 hash 동일, 기존 정책·의존9파일 baseline 동일. 마지막 worker 변경은 this:pg.Client 타입 표기뿐이며 이후 typecheck-final 통과.

실행 명령은 run-check.py가 명시 환경/임시키를 생성해 npm test, npm run typecheck, npm run lint, npm run build를 실행했다. native: node --experimental-test-module-mocks --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --test --test-concurrency=1 src/lib/data/databaseHealth.integration.test.ts. PG: node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs --import ./scripts/test-health-baseline-loader.mjs --test src/lib/data/health-tests/baseline.postgres.integration.test.ts. opt-in HEALTH_DATABASE_TESTS=1과 고정 소유 endpoint만 허용한다. 모든 로그·명령runner·소유권·정리 증거를 영속 cache로 복사했다.
