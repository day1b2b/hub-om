# 관리자 DB 실행 기록

Node24.19.0/PG17.9/Mongo8.0.30, env-i, 소유runtime `/private/tmp/hub-om-admin-database-20260929`, PG56659/admin_database_parity, Mongo27759/admindatabase20260929. 임시 키와 합성만 사용한다.

## 확인된 실행

- PGscalar preflight read-only: ±.005→±.01, precision경계/UUIDalias확인. Prisma 쓰기 검증과 구분한다.
- PG 대조 `logs/pg-parity.log` 5pass/0skip/0fail/exit0(2.86초). 실제45migration을 적용하고 원본query+formatter 전체 frozen oracle/newPG/Mongo 8표DTO 및 고정기대값·4표쓰기·UUID형식/부재오류·Decimal/Int32/null·unique·감사전체동등성 확인.
- 동일PII재저장(Member.name/OperationSession.omName)은세backend모두auditDelta0이다. PG 암호화migration의HMAC동일시감사skip규칙과Mongo논리비교가일치하므로감사를강제로추가하지않았다.
- native `logs/native.log` 42pass/0skip/0fail/exit0(46.5초). 실제8표0/99/100/101·Member NULLS LAST·sample밖관계·snapshot·BSONshort/32MiB·부분쓰기·unique/null·키/손상·후행감사원복·기존writer실충돌/재시도·누적deadline·준비오류무수리확인.
- main경계초기 typecheck-boundaryexit0, factory-hook1pass. 이후전체최종검사로대체예정.

## 실패/수정과 미완료

처음factory테스트2회는기존Notionclassparameterproperty가Node strip-only로실행불가해실패했다. productionNotion을고치지않고testresolvehook으로외부Notionreader선택만차단하면서실제storedfactory를검증해해소했다. 첫npm단독호출은PATH에npm경로가빠져exit127;opt/homebrew경로를포함해해소했다.

native검사전리뷰에서JSON DB-nullfixture를MongoDbNull로수정하고,의도적저장손상fixture는validator우회주입으로읽기거부단계까지도달하게했다. 애초native실패로집계하지않는다. 검사기대값은유지했다. Mongo쓰기후deadlinecheck를추가해알려진기한초과뒤후속감사명령을보내지않게했다.

추가 실제date검사 pg-date.log는3pass/2fail(부모포함)이었다. 원본PG/newPG가거부하는JS유효0000년을Mongo만허용했다. Mongo dateOnly쓰기에서year<1을safeerror로거부하도록보완했다. 정상0001/9999와2099-02-31→03-03 rollover,기간역전허용은유지한다. 최종 `logs/pg-final.log` 5pass/0skip/0fail/exit0(3.29초),원본/newPG/Mongo모든DTO/쓰기/감사대조통과. 기본PG helper의미사용optionalclient를제거하여항상scopeguard를통하도록정리한최종코드도이검사에포함한다.

최종 actualhandler/page+factory `logs/handlers.log`: 12pass/0skip/0fail/exit0(11.55초). 실제 권한·파서·UUID·unique·암호화 감사·업무/요청 감사 실패·scope 누락·화면 table/props/빈 상태와 실제 Mongo 담당자 목록을 확인했다. UI 컴포넌트/세션 공급은 stub이고 브라우저 E2E는 아니다.

최종 static 묶음 exit0: 일반 테스트 `logs/unit.log` 895pass/45skip/0fail, typecheck/build 통과, lint0error/기존7warning. 일반 테스트의 DB 환경 부재 skip은 통과로 세지 않는다. PG5·native42·handler/factory12는 일반/broad와 겹치므로 합산하지 않는다.

전체 Mongo `logs/mongo-bundle.log` 402pass/0skip/0fail/0cancelled, exit0(340.9초), 기존 mock4 포함. 이 실행의 glob에는 새 handler와 V3 추가 검사가 포함되지 않았으므로 별도 handler/factory12와 최종 native43을 보완 증거로 기록한다. 최종 `logs/native-final.log` 43pass/0skip/0fail/exit0(139.8초). 제품 코드는 broad 시작 이후 바뀌지 않았다.

Gibbs V1–V10 최종 독립 수락 PASS. 남은 P0–P3 코드 지적 및 필수 검증 공백 없음. 원본 dashboard oracle byte 동일 재확인: SHA256 e0eaed35f992b8bb638170fbd3c0cd4d99a313b965719c0495b985507e8df62f (정확한 전체 해시는 postgres 검사 상수 참조). cleanup·push/통합은 별도 단계다.

## 한계

실OAuth/브라우저E2E·실운영부하·실데이터/원천·복구리허설·운영전환미실행. 15s/30s/20s+15s는실DB명령·충돌과가상시계주입이며실30초네트워크장애보장과다르다. 전체백엔드선택은PG유지,일반NotionteamMemberfactory는이번범위밖이다. 선택100행과관계만조회하며sample밖모든손상행을전수검사한다는뜻이아니다.

## 독립 검증 공백 보완

Gibbs는 제품 코드 지적 없이 V3 Member 복합 keyset의 실제 여러 batch 검사가 빠졌다고 지적했다. gap-plan에 따라 실제 서버 batchSize만 1/3으로 제한하여 active/inactive·nonnull/null·날짜/ID 동률의 정확 순서와 무손실/no-getMore를 검사한다. 최초 추가 테스트 typecheck는 callback 인자 두 개의 암시적 any로 실패했다. Document[]/AggregateOptions 타입만 명시하여 최종 typecheck-gap/lint-gap 모두 exit0. 실행 중 읽힌 테스트의 런타임 코드는 동일하며 제품 코드 변경은 없다.

## 자원 정리

cleanup exit0. Mongo identity/dbpath/replica 확인과 합성DB0, PG 정상 종료, pid/lock 소멸 및 소유 pg/mongo dbpath 부재 확인. 검사 중 일시적인 디렉터리 부재 확인은 종료 대기 중이라 exit1이었으며 cleanup 완료 후 두 경로 부재를 재확인했다. 로그·실행 스크립트만 보존한다. 운영/원본 workspace/배포 변경 없음.
