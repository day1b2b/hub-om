# 과정명 복원 실행 검증

기준95cdb6f → feature/20260929-mongodb-course-name-restore. Node24.19.0, PostgreSQL17.9, MongoDB8.0.30. env-i, 신규 dbpath·loopback·합성자료·임시키로만 실행했다. runtime `/private/tmp/hub-om-course-name-restore-20260929`, PG56649/course_name_restore_parity, Mongo27749/courserestore20260929. 운영 데이터·실원천·키/env/배포에 접근하거나 변경하지 않았다.

## 확인한 최종 검사

- 일반 `logs/unit.log`: 893pass/42skip/0fail. opt-in 42개를 PASS로 합산하지 않는다.
- `npm run typecheck`, `npm run build` PASS. `npm run lint`: 0error/기존7warning. 최종 static 실행 exit0 확인.
- 실제 PG 대조/SSI + 원본 hash + adapter error 검사 `logs/pg-final.log`: 8pass/0skip/0fail, exit0.
- 실제 handler + factory `logs/handlers.log`: 8pass/0skip/0fail, exit0.
- 최종 전체 Mongo 회귀 `logs/mongo-bundle.log`: 360pass/0skip/0fail/0cancelled, exit0. 신규 native31·handler7 및 기존 mock4를 포함한다. 전체259.2초, 신규 native134.3초는 이번 로컬 실행 기록이며 성능 보장이 아니다.

PG는 45개 migration을 신규 합성 DB에 적용했다. 원본 fixture/newPG/Mongo 각각 독립 fixture를 준비하여 고정 예상 DTO·복원 결과·감사 5개·기존 과정과 비관련 raw 보존·새 과정 한 개/번호1001을 비교했다. PG 지문은 원본과 byte 일치, Mongo는 지문을 제외한 의미를 비교한다. PG의 실제 Serializable 경합은 같은 계획의 서로 다른 회차 선택 중 한 번만 성공하는지 확인한다.

실제 handler는 인증값만 합성 주입하며 실제 권한 guard/withActivity를 통과시킨다. 403/400/413/409/500/200, 32KiB 제한·정확한 문자열ID·scope 누락·PG 우회 차단, 업무/감사 원자성, 후행 요청 로그 실패의 업무 성공 보존과 고정 안전 오류를 검사한다. 실 OAuth/브라우저 E2E를 실행했다는 뜻은 아니다.

## 실패와 수정 이력

1. handler 테스트 초안의 괄호 오타를 실행 전 정적 확인에서 발견하여 수정했다.
2. 첫 PG 실행과 원인 확인 실행은 각각 5pass/2fail이었다. 실제 COMMIT 단계에서 adapter-pg가 P2034 대신 `DriverAdapterError`의 `TransactionWriteConflict`/SQLSTATE40001을 직접 던졌다. 원본 fixture에서도 재현했다. newPG에 이름·kind·40001/40P01이 모두 일치할 때만 기존 재조회 오류로 변환하는 보완을 넣었다. 다른 오류를 삼키거나 문자열만 보고 재시도하지 않는다. 원본 oracle의 알려진 raw COMMIT 오류만 baseline 예외로 기록하고, newPG에는 domain conflict를 반드시 요구한다. 최종 PG 8pass로 확인했다. 실제 deadlock은 별도 유발하지 않았으며 40P01 매핑은 단위 검사다.
3. 첫 native Mongo 실행은 28pass/3fail이었다(하위 2개와 부모 1개). JSON DB-null fixture를 raw null 대신 기존 codec의 MongoDbNull로 바로잡았다. 또한 가상 deadline을 넘긴 성공 명령 뒤 다음 DB 명령을 보내면 driver CSOT 오류가 먼저 나올 수 있어, counter 증가·과정 삽입·과정 감사·회차 갱신 직후 deadline을 검사하도록 보완했다. 기존 35초 초과·원자적 취소·다른 승자의 변경 보존 기대를 약화하지 않았다. 최종 코드로 static/전체 Mongo를 다시 검사하여 모두 통과했다.

처음 실패를 PASS로 처리하지 않는다. 명령 도중 driver CSOT가 먼저 만료되면 고정 TRANSACTION_FAILED로 반환될 수 있으며 모든 timeout을 같은 오류 코드로 보장하지 않는다.

## 검증 범위 V1–V9

- V1: 고정 원본 hash, 원본/newPG 실제 대조, 명시 DB 주입·scope 차단, 실제 route 상태/입력 경계.
- V2: 정규화 ID·기업·0회차 과정·활성 회차·최신 두 원천·무효 최신의 과거 fallback 금지·차단 우선순위·전체 계획 메타데이터 충돌.
- V3: PG 지문 유지, Mongo 논리 지문 안정성. 관련 변경은 stale, 무관 과정/옛 원천/재암호화/JSON key 순서는 안정. backend 간 지문 상호 교환은 지원하지 않는다.
- V4–V5: guard 쓰기 후 predicate 읽기, 조회 무쓰기, 첫 upsert/동일·서로 다른 회차/기업 경합, 기존 대상 재사용으로 counter에 의존하지 않는 한 번의 성공·이후409. 무관 코스 작업은 모두 성공할 수 있다.
- V6–V7: 기존 대상 불변·기업/이름별 신규 한 개·부분 필드 갱신·관계와 암호문 보존. 후행 업무/감사 실패 시 앞선 과정/회차/감사/counter/guard 전체 취소.
- V8: 기존 selected writer의 변경/삭제/과정 일괄 삭제/복원/보정 경합과 실제 충돌 후 재검증. 이미 끝난 원천/과정/미선택/새 대상 변경은 stale. 미참여 writer 전체에 PG Serializable과 같은 보장을 주장하지 않는다.
- V9: 101행 읽기/100개 선택·실제 BSON 짧은 batch·32MiB 한도. 가상시계의 scan15s/전체30s 및 실제 guard 충돌 후20s+15s 누적 deadline과 취소 확인. 실30초 네트워크/부하 시험과 구분한다. 실제 2만행 경계 전수 검사는 별도 미실행이다.

## 명령과 한계

`env -i HOME=/Users/ga /bin/bash <runtime>/run.sh static`은 npm test/typecheck/lint/build를 수행한다. mongo는 Node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test --test-concurrency=4로 mongo*.integration.test.ts 및 기존 mock/team 묶음을 실행한다. PG 최종은 같은 Node 옵션으로 PG oracle 및 adapter 오류 파일을, 직접 handler는 handler/factory 파일을 실행했다. 묶음 간 handler/factory/oracle 단위 검사가 겹치므로 결과를 합산하지 않는다.

실 OAuth·브라우저·실데이터/원천·운영 부하·복구 리허설·생산 전환은 미실행이다. 기존 opt-in courseNameRestore.integration.test.ts는 일반 테스트에서 skip이며, 새 실제 PG suite가 원본/newPG/Mongo 대조와 SSI를 검증한다. 기존 검사를 실행한 것처럼 표현하지 않는다. PG 기본·기존 UI/API·업무 schema를 유지하며 내부 Mongo coordination 컬렉션만 추가한다.

## 독립 검토와 자원 정리

Gibbs가 최종 로그와 코드를 대조하여 V1–V9 기능·실행 검증을 PASS로 수락했다. 남은 P0–P3 코드 지적 없음. 리뷰어는 로그를 직접 읽었고 프로세스 exit0는 main 도구 결과에 근거함을 구분했다. 지적한 문서의 실행 대기 문구는 최종 결과로 갱신했다.

소유 PG56649/Mongo27749 정상 종료. Mongo dbPath/replica 이름을 먼저 확인하고 남은 합성 DB0을 확인했다. PG postmaster 파일 부재·Mongo 잠금 해제 후 소유 dbpath 두 개만 제거했다. cleanup exit0와 경로 부재를 확인했다. 로그/실행스크립트는 보존했으며 다른 namespace·원본 workspace·운영 데이터는 수정하지 않았다.

성공 검사 이후 구현·테스트 코드 변경 없음. 기능 commit/push 및 총괄 통합 SHA는 integration-review.md와 최종 원격 ref로 추적한다.
