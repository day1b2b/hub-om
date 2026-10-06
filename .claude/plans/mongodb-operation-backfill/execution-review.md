# 운영 보정 실행 검증

기준118e276 → feature/20260929-mongodb-operation-backfill. Node24.19.0/PG17.9/Mongo8.0.30, env-i, 새 dbpath 및 합성자료·임시키. runtime `/private/tmp/hub-om-operation-backfill-20260929`, PG56639/operation_backfill_parity, Mongo27739/operationbackfill20260929. 운영/실원천/키/env/배포접근없음.

## 확인된 검사

직접 Node PG+handler+factory 묶음 `logs/backfill-api-pg.log`: 11pass/0skip/0fail/0cancelled, 직접프로세스exit0. 실제PG45migration, 고정16사례원본PGquery/newPG/nativeMongo 독립fixture대조. onsite12/OM6 대상, 감사18개 의미일치, 비관련raw/관계/암호문 및재실행0불변. 실제관리자guard/withActivity/미설정context/fallback차단·POSTbody미사용·콘솔/저장평문비노출·후행requestlog실패업무성공을검증했다.

일반 unit.log 890pass/39skip/0fail/0cancelled, typecheck/build PASS, lint0error/기존7warning. static wrapper exit0 확인. 39opt-in은PASS로합산하지않는다. broadMongo 최종322pass/0skip/0fail/0cancelled, mongo-bundle.log 및프로세스exit0 확인. 신규native36·handler6 포함, mock4포함. 신규native실행54.5초, 전체197.2초는이번로컬환경기록이며성능보장이아니다. broad와직접묶음은handler등중복되므로합산하지않는다.

## 명령·한계

실행은 env-i의 run.sh setup/static/mongo, 직접 Node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test 신규PG/handler/factory3파일. static은 npm test/typecheck/lint/build, broad는--test-concurrency=4로기존mongo*.integration.test.ts+mock참조+team suite실행. 실제DB는소유loopback만접속한다.

실OAuth·브라우저E2E·실데이터/원천·운영부하·복구리허설·생산전환은미실행. 가상시계15s/30s/실충돌후20s+15s는실DB쓰기와deadline로직검증이며실30초부하/네트워크장애보장과구분한다. GET/POST대상예약·모든writer순서충돌·인덱스제외손상행전수검증은보장하지않는다. 기존legacyonsiteCLI와관리자호스트는별도미전환이다.

## 독립 코드 검토 (Gibbs)

P0–P3 코드 지적 없음. V1–V3/V5의 기존조건·권한·부분갱신·재실행과 V9 handler안전로그 확인. V4/V6–V8 및 context-free감사는 native테스트설계공백없으나실행완료전으로수락대기. PG/handler/factory11과static증거확인, broad최종을근거로V10실행수락예정. 계획수락/코드검토를실DB완료와혼동하지않는다.

## V1–V10 실행 근거

V1/V9 actualhandler6: admin거부, 명시scope누락/PGfallback차단, GETDTO·POSTbody미사용·requestID감사와암호화actor, 후행requestlog실패업무성공. factory1은defaultPG/동시·중첩scope확인.
V2/V3/V5 actualPG원본query/newPG/Mongo3backend(부모포함4): 고정16사례조건과onsite12/OM6·감사18, 비관련raw/관계보존, count무쓰기/재실행0불변.
V4 native: 실제HMAC조회조건관측, 선택후보의위조HMAC·암호화키/index키불일치고정오류/무변경.
V6 native: 201대상중101번째실제updateOne/insertOne성공뒤예외, 앞선100개업무·감사까지전체raw원복.
V7 native: 기존MongoOperationRepository name/status/update/delete와MongoCourseAdmin bulk선행→실code112충돌/retry·조건재평가, 같은/다른보정양방향경합·감사중복/필드유실없음. 모든writer양방향조합전수검사가아니다.
V8 native: 실제101행keyset·BSON짧은batch·32MiB한도, 가상15s/30s 및실충돌후누적20s+15s deadline전체원복. 실제20k행한도경계별도실행은하지않고공통scan사용을확인했다.
V9 native: context없는내부apply무감사, readiness실패시DDL수리없음.
V10 일반890/39skip 및broad322/direct11·static통과. 독립최종수락/cleanup/push/통합은아래및integration-review후속기록.

이번변경의검사실패는없었다. Nodeexperimental/module경고및기존lint7경고를새실패로세지않았다. 성공검사후구현·테스트코드변경없음, 동일검사를반복하지않는다.

## 독립 최종 수락과 자원 정리

Gibbs가 최종 로그를 대조하고 V1–V10 기능·실행 검증을 PASS로 수락했다. 남은 P0–P3 코드 지적이나 필수 검증 공백은 없다. process exit0는 main의 도구 실행 결과로 확인했고 리뷰어는 해당 근거와 직접 읽은 로그를 구분했다.

소유 PG56639/Mongo27739 정리 완료. Mongo getCmdLineOpts의 dbPath 및 replica 이름을 확인하고 남은 합성 DB0을 확인했다. 정상 종료·PG postmaster 파일 부재·Mongo 잠금 해제 후 소유 dbpath 두 개를 제거했다. cleanup wrapper exit0와 두 경로 부재를 확인했다. 로그와 실행스크립트는 보존했고 다른 namespace/운영 데이터는 접근하거나 삭제하지 않았다.
