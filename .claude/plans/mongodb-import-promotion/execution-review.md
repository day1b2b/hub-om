# 실행 검토

현재: 최종 제품/합성 검증과 소유 자원 정리를 마쳤고 독립 최종 수락·원격 통합을 대기한다. 최종 수치: 일반922pass/71skip/0fail, 실제PG54pass/0skip, Mongo49파일의 최종 중복 제거833pass. 최종 promotion 두 파일82(저장60/API22)는833의 부분집합이다. typecheck/build 통과, lint0error/기존7warning. 첫 전체 wrapper exit1은 아래에 별도 기록한다. 아래 문단은 단계별 기록이다.

기준75125c9, 새feature/20260930-mongodb-import-promotion. 선행 staging 통합/검증을 반복하지 않는다. service 원본 fixture와 route 원문을 SHA 고정했다. plan-v2/validation-v2는 6개 critic gap과 meta의 상태/경쟁/추적표 보완 후 독립 착수 검토를 통과했다. 공통 core, 기존 PG adapter, 명시 Mongo repository, actual POST의 저장/Calendar 경계를 구현했으며 현재 검증 중이다. 완료·독립 수락·통합 전이다.

새소유합성환경 `/private/tmp/hub-om-import-promotion-20260930`: PG17.9/56739/import_promotion_parity, Mongo8.0.30/27839/importpromotion20260930, Node24.19/env-i/LC_ALL=C. setup.log exit0. 새dbpath/포트/합성키만사용한다. 현재서버실행중이며종료후cleanup.sh로소유확인·정리해야한다. 이전staging의서버/DB는정리완료이고증거만남았다. 최종전체Mongo는앞선4병렬roottimeout근거에따라2파일병렬로실행예정이며검사assert/timeout을완화하지않는다.

운영/실원천/키env/배포/main/dev/원본workspace/자동화변경없음. 실제백업·복원·최종전환증거0.

## 현재 실행 근거

- 제품 최초 typecheck와 테스트 작성 후 typecheck 각각 exit0. 전체 회귀를 대신하지 않는다.
- native-smoke.log exit0: 실제 Mongo의 신규 생성·빈 재실행·업무키 연결·삭제 표시 지문 복원, 1.005→1.01, 복호화 응답과 원시 평문 비노출. 임시 진단이며 정식 oracle 검사 수치에 합산하지 않는다. 해당 임의 DB는 finally에서 정리했다.
- handlers-first.log exit1: 동결 route를 data URL로 로드하면서 `next/cache.js`의 기준 URL이 없어 테스트 import가 실패했다. 업무 실행 전 실패이며 테스트 harness의 모듈 해석을 보완 중이다. 원본 route fixture와 제품을 이 실패 때문에 바꾸지 않는다.
- 추가 동시성 검토: 일반 운영 생성은 promotion guard에 참여하지 않는다. Company 자연키 생성 경합과 같은 업무키 동시 생성은 분리해 원본 PG를 대조한다. 전체 transaction 재시도는 업무키를 다시 조회하므로 PG READ COMMITTED의 동일 실행 순서와 결과가 달라질 수 있다. 실제 결과가 나오기 전 동등성이나 완료를 주장하지 않는다.

## 추가 동시성 근거와 발견한 감사 결함

- pg-first.log: 42pass/0skip/0fail. 실제 원본 PG와 현재 PG는 두 INSERT를 barrier에 도달시킨 일정에서 같은 업무키라도 두 운영을 만든다. 실제 직렬 순서는 일반 등록 선행이면 기존 연결 한 건, promotion 선행이면 두 건이다.
- native-first.log: 56pass/0skip/0fail. 실제 insert 경합 4건은 11000 또는112가 발생한 증거다. 모두 NaturalKeyRace 분기를 통과했다고 해석하지 않는다. 정확한 keyPattern/keyValue 분기와 Course 방어적 분류는 별도 오류 주입으로 검증한다.
- pg-race-first.log: 54개 중 49pass/5fail(4개 자식과 root). 동일 fixture의 PG 실제 겹친 요청·직렬 결과와 Mongo 실제 네 경합의 전체 tuple을 비교하자, 기존 일반 Mongo writer의 INSERT 감사에서 nullable 항목이 누락된 문제가 드러났다. 업무 건수/참조를 지우거나 감사 필드를 제외해 통과시키지 않았다.
- 최소 제품 보완: mongoOperationRepository.write의 실제 신규 Company/Course/OperationSession만 complete row의 필드를 forceChangedFields로 전달한다. UPDATE/no-op/개인정보 redaction/다른 writer의 정책은 유지한다. schema·업무값·새 감사 대상은 추가하지 않는다.
- pg-race-fixed.log: 54pass/0skip/0fail, 25.5초, exit0. 실제 Mongo 네 insert 경합의 summary·전체 행/원천 참조·원본 값·감사 actor/action/필드가 하나의 원본 PG 허용 일정 전체와 일치한다. PG 쪽도 겹친 서비스 호출에서 선행 commit 후 상대의 업무 조회가 시작되는 일정을 실제 구성했다. 특정 동시 일정의 PG 두 건/Mongo 한 건 차이는 그대로 기록했고 전역 직렬화나 항상 한 건을 보장하지 않는다.

전체Mongo 첫 실행 중 위 일반 writer 보완이 들어갔으므로 해당 단일 실행을 최종 불변 소스 전체 PASS로 주장하지 않는다. 완료 후 직접/간접 의존 검색에 따른 영향 파일을 최종 소스로 재검증해 파일별 최종 결과를 합친다. actual POST의 실제 insert 경합 Calendar 횟수도 추가 검증한다. 최종 회귀·독립 수락 전이다.

## 최종 소스 검사 진행

source-digests.json의 변경 소스 16개를 고정했다. 일반922pass/71skip/0fail, typecheck/build exit0, lint0error/기존7warning. handlers-race18pass/0skip/exit0에는 실제 Company insert 경합 두 건과 callback/commit 중 Calendar0, 요청 성공 뒤1, 재요청 추가1이 포함된다. dependency인 operation shadow script도 소유 서버에서7개 check 통과,9개 소유 collection 정리/잔존0을 보고하고 exit0이었다.

full-mongo-first.log는54개 root/823pass/0fail/0skip TAP를 완결했지만 wrapper는 exit1이다. 실행 중 부모가 같은 run.sh에 영향 재검사 분기를 추가한 것이 추정 원인이다. 완결 TAP 뒤 `files: unbound variable`이 발생했다는 사실과 shell exit1은 확인했지만 당시 bash 파일 offset을 별도로 관측하지 않았다. 이 wrapper 실패를 숨기거나 전체 명령 exit0이라고 보고하지 않는다. 이후 실행 driver는 고정 복사본(run-frozen-final.sh)을 사용하며 실행 중 수정하지 않는다. 최종 run.sh 구문 검사는 통과했다.

최종 영향 묶음은 직접 소비12파일에 새 실제경합 handler를 더한13파일이다. impact-source-before.json에 정확한 파일/의존 SHA를 고정했고 mongo-impact-final.log로 실행 중이다. 변경 없는 파일의 완결 TAP와 이 최종 파일별 결과의 합집합 수락 여부를 독립 검토한다. 완료/정리/통합 전이다.

## 최종 필수 부모 무결성 보완

영향13파일은369pass/0skip/exit0, 실행 전후 테스트·일반 writer 소스 동일성을 impact-source-after.json에 확인했다. 이 시점의 파일별 최종 합집합은825였다.

이후 부모의 필수 참조 재점검에서 DataImportRun 없는 source가 승격되는 결함을 실제 합성 probe로 재현했다(missing-run-red.log, Missing expected rejection, exit1). PG에서는 필수 FK 때문에 존재할 수 없는 상태다. 원본 core의 없는 run 빈 결과를 그대로 Mongo에 적용하면서 고아 source를 검사하지 못한 P1로 독립 검토자가 분류했다.

Mongo listUnlinkedSources에만, 행이 실제로 있을 때 같은 transaction의 부모 run 확인을 추가했다. 없는 run+source 없음의 빈 결과는 그대로다. core/PG/업무 schema는 바꾸지 않았다. run/course/company 누락의 raw rollback 세 검사를 포함한 중간 Mongo77/0skip/exit0와 PG54/0skip/exit0, type/build/일반·lint를 확인했다. 이어 blocked-only 고아 source와 실제 API의 부모 누락 네 경우(eligible/blocked run, course, company)를 추가해 고정 오류·Calendar/revalidation0을 검증한다. 중간77 로그는 mongo-parent-fixed-before-api-gaps.log에 보존했고 최종 두 Mongo 파일은 mongo-parent-fixed.log로 다시 실행 중이다. 새 제품 변경 없이 테스트만 추가했으므로 최종 unit/type/lint를 재검증하고 같은 제품 build는 반복하지 않는다.

최종 집계는 이전825에서 이 두 Mongo 파일의 이전74 결과를 새 최종 결과로 교체한다. 완결 TAP/exit와 최종16 source digest를 확인하기 전 수락하지 않는다. 독립 최종 수락·소유 자원 정리·통합은 대기다.

## 최종 실행·정리

- mongo-parent-fixed.log: 82pass/0skip/0fail/0cancel,91.7초,exit0. run/course/company 필수 참조와 blocked-only 고아 source의 저장 원자성 및 actual handler 고정 오류/Calendar0/revalidation0을 확인했다.
- pg-parent-fixed.log:54pass/0skip/exit0. 최종 제품에서 원본 PG/current PG/Mongo 값·감사·원천 연결과 실제 허용 경합 tuple 대조를 다시 통과했다.
- unit-parent-gaps922pass/71skip/0fail, typecheck-parent-gaps/lint-parent-gaps exit0. 린트는 기존7warning만 있다. build.log는 최종 제품 수정 이후 exit0이고 이후 테스트 추가만 있어 빌드를 반복하지 않았다.
- regression-by-file.json: first823의 완결 TAP에서 영향13파일367개 결과를 최종369개로 교체하고, 그중 promotion 두 파일74개 결과를 최종82개로 교체했다. 합집합은49파일833개다. 독립 reviewer가 파일별 교체 방법을 조건부 수락했으며 전체 단일 명령 exit0이라는 주장은 하지 않는다. 기존 mock4 및 합성 외부/오류 주입은 native 서버 검증과 구분한다.
- source-digests16개는 최종 실행 전후 일치한다. 영향13의 전후 snapshot과 이후 부모 참조 보완 전후 snapshot을 별도로 보존했다.
- cleanup.sh exit0. 소유 PG public 객체0/Mongo 사용자DB0을 확인한 뒤 소유 서버만 종료하고 두 dbpath를 삭제했다.56739/27839 포트 닫힘을 확인했다.
- 영구 증거: `/Users/ga/.cache/hub-om-verification/20260930-import-promotion`,54개 파일의 SHA256. 최초 실패/중간 성공/최종 성공과 실행 driver·source snapshot·정리 기록을 보존했다. 원격 확인 기록은 통합 후 별도로 추가한다.

미검증: 실제 운영 데이터·Atlas·Google/OAuth/Slack·브라우저 렌더링·실제 프로세스 crash·운영 A/B 백업/복원/최종전환. 오류/시계 주입은 실제 장애 실험이 아니다. 생산 기본 PG, 운영 설정/원본 workspace/main/dev/자동화는 변경하지 않았다.
