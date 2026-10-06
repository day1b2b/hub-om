# 공지·첨부 실행 증거

factory scope/defaultPG/모든직접PG메서드차단1pass0fail exit0(factory.log). 초기 typecheck-boundary는PrismaBytes의Uint8Array<ArrayBuffer>와인터페이스ArrayBufferLike차이2곳실패;PGadapter에서Buffer.from을거쳐값을유지하며해소한다. typecheck-boundary-fixed exit0 확인. Mongo 구현 취합 후 typecheck-implementation도 통과했으며 실제PG bytes 대조는 별도 실행한다.

소유 PG56669/Mongo27769 기동 exit0. 실제업무검사·전체회귀·독립최종리뷰·cleanup·push/통합미완료. 파일존재/논리검토를실행PASS로처리하지않는다.

## 첫 실제 검사와 보완

PG1차 pg-parity.log:1pass4fail. 세backend모두2099 fixture보다현재updatedAt이크다는잘못된기대에서실패했다. 요청시작/종료시각범위와이전값과다름으로수정. PG2차 pg-second.log:2pass3fail. Mongo는진행했으나PGprivacy wrapper가숨기는companion을논리응답에서읽어undefined/null차이로실패했다. 저장raw companion검사와응답검사를분리해보완중이며기대정책은유지한다.

native1차 native.log:17pass12fail. 첫DTO정렬keys기대배열이정렬되지않았고 Symbol.asyncIterator mock복원뒤원본이undefined로오염되어후속prepare검사가연쇄실패했다. 테스트의정렬기대값과descriptor보존/finally복원을수정. 제품코드변경없음.

native2차 native-second.log:29pass0skip0fail exit0(10.36초). 실제5x5MiB roundtrip/BSONshort/noGetMore,후행첨부·감사원복,실PUTPUT/PUTDELETE충돌,키/HMAC/Bytes손상,101행,계측한도·가상누적deadline/open무수리모두통과. BSON문서당9,321,107bytes. 최초최대fixture본체764ms/RSS182,599,680→469,090,304bytes/maxRSS461,360KiB(Node24.19.0 darwin arm64)관찰. 최종회귀의측정값도보존한다. 임의성능합격선이나운영부하보장은아니다. 실제20k행과32/64MiB정확저장경계는미실행;공개cursor계측주입으로counter/초과시부분반환금지만검증했다.

## 실제 PG 최종 대조

pg-third.log 5pass0skip0fail exit0(2.27초). 원본PG query/select/nestedwrite oracle·newPG·Mongo의10메서드DTO·UUID별표기·무효/부재·쓰기·첨부보존/혼합·softdelete/stalePUT·nullable/동일값감사전체대조통과. 개인정보wrapper가숨기는companion은raw저장에서HMAC/null검사하고논리응답비교에서만제외한다. oracle불변,제품코드변경없음. 45개migration은정확한소유합성PG에만적용했다.

## 실제 API·페이지와 정적 회귀

handlers.log 첫 실행 10pass/2fail(부모 포함): 마지막 손상 데이터 fixture를 정상 validator가 거부했다. 의도적 손상 주입에만 bypassDocumentValidation을 지정했다. 추가로 실제 POST 5파일/정확5MiB와 저장된 미정제 HTML의 상세 페이지 정제·편집 초기값 보존을 검증했다. handlers-final.log 13pass/0skip/0fail exit0.

일반 unit.log 897pass/48skip/0fail, typecheck/build PASS, lint 0error/기존7warning. 최신 handler 테스트 변경 후 typecheck-final/lint-handler-final도 exit0. 일반 테스트의 DB skip은 별도 실제 DB 검사를 대체하지 않는다. 테스트 묶음은 겹치므로 합산하지 않는다.

진행 중 첫 broad는 수정 전 handler 파일을 로드하여 같은 fixture 실패를 포함한다. 최종 전체 PASS로 처리하지 않으며 종료 결과와 최종 재검사를 분리 기록한다.

## 독립 리뷰 보완

Gibbs의 raw Bytes 비교 P2와 동시 첨부 추가 증거 보완은 gap-plan을 따른다. 실제 바이트 비교·평문 음성 검사와 실제 동시 추가 4→6 경합을 추가했다. 제품 코드와 원본 oracle는 변경하지 않았다. 보완 실행·최종 수락은 아래 결과로 판정한다.

보완 최종 pg-final 6pass/0skip/0fail, native-final 30pass/0skip/0fail, typecheck-review/lint-review exit0. 실제 바이트와 빈 원본 비교 및 평문 음성 검사, 4→6 동시 추가의 실제 WriteConflict와 감사 중복 방지를 확인했다. 일반 최종 unit-final 898pass/48skip/0fail exit0(946tests). 제품 변경 없이 테스트 보완만 추가했으므로 기존 build PASS는 동일 제품 코드의 증거다.

첫 broad mongo-bundle.log 최종 453pass/2fail/0skip(455tests), exit1. 수정 전 손상 fixture의 자식/부모 실패 두 개뿐이다. 최종 파일 전체 재실행 mongo-bundle-final은 별도 기록한다. Gibbs는 보완 코드와 PG/native 로그를 읽고 P2 해소, V1–V10 PASS로 수락했으며 V11 전체 회귀는 보류했다.

## 재현 조건과 명령

Node 24.19.0, PostgreSQL 17.9, MongoDB 8.0.30. 환경은 env -i에서 시작하고 런타임 PATH/HOME와 명시 loopback 테스트 URI만 주입했다. 테스트가 임시 키를 생성하며 실제 비밀값은 사용하지 않는다. 모든 로그·실행 스크립트는 로컬 `/private/tmp/hub-om-announcements-20260929/`에 보존한다.

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- 실제 DB 테스트는 Node의 `--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/ts-loader.mjs --test`로 해당 PG/native/handler 테스트 파일을 실행했다.
- 전체 Mongo는 위 옵션에 `--test-concurrency=4`를 적용하여 `src/lib/data/mongo*.integration.test.ts`, `src/lib/data/mongoTeamMemberRepository.test.ts`, `src/lib/data/teamUsers/mongoTeamUserRepository.integration.test.ts`를 실행했다. 각 기존 테스트 URI는 동일 소유 replica set을 가리키며 테스트별 DB/namespace를 분리한다.
- 검증 중 원천 호출은 하지 않았다. PG oracle는 `5f9d291` 원본 query/select/nested-write의 해시 `10aaf4606b7a018b3bd05ad56125cbe037794068a69d42e64b1700b9f73b964f`를 고정한다.

단위 검사·특화 검사·전체 Mongo 묶음은 중복하므로 합산하지 않는다. mock 4개는 실제 DB 검사와 구분한다. 실제 20k/모든 byte 경계·브라우저/OAuth·운영 부하·실제 복사/복원/운영 전환은 PASS로 처리하지 않는다.

## 최종 전체 회귀·독립 수락·정리

최종 mongo-bundle-final.log 457pass/0skip/0fail/cancelled0, exit0(390.45초). mock 4개 포함. 수정된 handler와 동시 첨부 추가 검사를 포함한다. Gibbs가 최종 로그를 직접 읽고 V1–V11 PASS, 미해결 P0–P3 없음으로 수락했다.

최종 최대 첨부 관찰: 원본 26,214,400bytes, BSON 각 9,321,107bytes, fixture 본체 1487ms, RSS175,833,088→463,290,368bytes, maxRSS456,160KiB. Node24.19.0/darwin/arm64. 운영 성능 보장은 아니다.

cleanup exit0. Mongo replica/dbpath 소유 확인 후 남은 합성 DB 0을 확인하고 정상 종료했다. PG 정상 종료, 소유 pg/mongo dbpath 제거 및 부재를 별도 확인했다. 로그와 실행 스크립트만 보존했다. 운영·원천·키/env·권한·배포·원본 workspace는 변경하지 않았다. feature push와 총괄 원격 통합은 integration-review에 기록한다.
