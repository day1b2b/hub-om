# 실행 기록 — 완료

현재 상태: V1~V8 독립 수락, V9 실행·정리·증거 보존 수락. 제품 변경·추가 검사 필요 근거 없음. 일반921/68skip, PG18, 전체Mongo파일별751성공, typecheck/lint/buildPASS. 소유서버는종료·정리됐다. 제품c11a05c를총괄에FF·atomic push했고양쪽원격SHA를확인했다. 마지막문서SHA는integration-review/final-remote증거를따른다. 지속증거와해시는 `/Users/ga/.cache/hub-om-verification/20260930-import-staging/sha256.json`을따른다. 아래이전진행상태는실행당시이력이며현재상태로해석하지않는다.

## 초기 실행 이력

2026-09-30. plan-v2 구조 독립 수락 후 구현 중. 범위는 upload→staging→검토, 생산기본PG 유지. 원본8e19638 reader/writer fixture2개의byte/SHA 일치 확인. MongoImportRepository 및 PG공유presenter/validation/factory/context/page/upload오류가림 구현. 테스트 작성과 독립 정적 검토 진행 중이며 완료/운영전환으로 표현하지 않는다.

## 실행한 검사

- 첫 product 상태 `npm run typecheck`: exit0. 이후 Node24 strip-only 호환을 위해 parameter property를 기존 명시 field+constructor 방식으로 수정했다.
- 실제 Node24 모듈 로드(DB 접근 없음): exit0, module-smoke.log.
- 기준 원본fixture2개 SHA 일치, diff whitespace 검사 통과. 최종source digest는검증종료후갱신.
- actual native smoke exit0: 합성 CSV 오류행보존/store→read→replay(새원천행0/중복run)와raw source암호화 확인. smoke자체DB는finally정리. native-smoke.log. 이는정식oracle/회귀를대체하지않는다.
- 정식 native/PG/handler·전체회귀는 아직 실행 전.

## 소유 합성 환경

root `/private/tmp/hub-om-import-staging-20260930`, Node24.19, PG17.9 loopback56729/db import_staging_parity/user synthetic, Mongo8.0.30 loopback27829/replica importstaging20260930. 별도새dbpath/임시key/합성자료만. 실제운영/원천접속없음. 현재두서버실행중,검사종료후root의cleanup.sh로소유확인/정상종료/정리한다.

최초setup은macOS PG의로케일부재로 multithreaded startup fatal,서버정상종료. 로그setup.log/postgres.log 보존. LC_ALL=C 지정후기존새initdb를재초기화하지않고start부터재개해 setup-resume.log exit0, 두서버준비확인. 원본환경설정은변경하지않았다.

## 검증상 주의

기존두staging테이블은mutationaudit제외,requestActivity는별도best-effort. 확정abort와unknowncommit을구분한다. 같은sourceType run을인증후HMAC조회하므로wrongindexkey miss중복을막고write에도scan20k/32MiB/15s한계를적용한다. 실제로확인하지않은가정은PASS처리하지않는다. 실제백업/복원/전환증거0상태유지.

독립 Volta product정적검토: P0–P2반례발견없음. sourceType선인증/HMAC원문확인,transaction/별도감사,기본PG/누락scope/권한/allowlist및원본SHA확인. 실제PG/native/handler검증은아직수락하지않음.

## 실제 검사 1차 및 보완

- handlers-first.log: 실제 upload/pages/권한/scope/requestaudit/PG승격차단 15pass/0skip/0fail.
- pg-first.log: 10pass/4fail. 원본PG와currentPG에서 startedAt<=finishedAt 가정이 실패했고 Mongo 비교가 원본결과 미등록으로 연쇄실패. 기존PG finishedAt은클라이언트에서먼저생성, startedAt은DB default여서그관계는보장되지않는다. 해당가정만삭제하고각timestamp의호출구간/이전완료이후순서/DTO원시값대조는유지. 제품/원본fixture변경없음.
- typecheck-tests.log: 새테스트의undefined/Seed캐스팅/도달불가분기 타입오류4개. 각소유agent가검증의미유지하며수정. native실행/PG재실행/전체static진행중.

## 보완 후 영향검사 및 일반 회귀

- pg-second.log: 14pass/0skip/0fail. 원본PG/currentPG/Mongo 대조, 실제PG 두동시중복조회 barrier 포함.
- native-first.log: 30pass/0skip/0fail. 실제replica set storage와 별도로 명시한 오류·시계·commit응답 주입 포함. 실제standalone서버 검증은 하지 않음.
- static-run: exit0. unit.log 921pass/68skip/0fail, lint.log 오류0/기존경고7, typecheck-final.log/build.log 통과. opt-in skip은통과로세지않음.
- full-mongo.log: 진행중. 영향검사 수와 전체Mongo는 겹치므로 합산하지 않는다.
- fetch후 dev307f52f/총괄8e19638 변화없음.

## 독립 Gap 보완 실행

- handlers-gap.log: 16pass/0skip/0fail. 정확한 공개 문구 4개·각 문구+민감 suffix·미등록 한국어 오류를 Error/MongoServerError 18사례로 실제 POST catch에 주입했다. 정확한 일치만 허용하며 native driver 실패 사례와 구분한다.
- pg-gap.log: 18pass/0skip/0fail. 원본/현재PG × local/notion 환경 4사례에서 실제 PG 연결과 저장을 완료하고 PG OM/LD/강사만 교체해 검증 결과가 달라짐을 확인했다. local/Notion/fetch tripwire0. 원본/현재 전체행 대조 유지.
- typecheck-gap/lint-gap exit0, lint 오류0/기존경고7. 보완은 테스트만이라 미변경제품 build를 반복하지 않았다.
- 전체Mongo 첫 실행에서 기존 coachContent root 240초 timeout. 하위41항목은 모두PASS였지만 전체파일은실패다. 전체실행종료후같은코드·원래timeout으로단독재검증한다. timeout이나제품을근거없이수정하지않는다. 아직전체PASS아님.

## 첫 전체 Mongo 회귀의 정확한 결과

`full-mongo.log`, exit1, 692 tests: 689pass/2fail/1cancel/0skip. 실패2개는 기존OM concurrency/handler의 이전합성주소 고정assert(접속전)이며 cancel1은기존coachContent root240초timeout이다. 세부41건PASS를묶음PASS로바꾸지않는다. 해당3파일만원래timeout/업무assert를유지한채 concurrency1로재실행중이다. OM2개에는정확한새소유URI/port-replica쌍만추가했고독립diff수락을받았다.

full 회귀에는 보완된 handler의 exact allowlist test도 포함됐다. 테스트 파일만 수정한 후 일반회귀 unit-final921pass/68skip/0fail, typecheck-endpoint/lint-endpoint exit0(기존경고7)을 확인했다. 제품은최초build이후변경없다. 최종전체회귀집계는파일별최종결과를사용하며재실행/PG/일반검사를중복합산하지않는다.

## 실패 묶음 재검증 완료

`mongo-failed-recheck.log` exit0, 103pass/0fail/0skip/0cancel. coachContent42(root포함), OM concurrency41, OM handler20이다. coachContent는제품·테스트·240초제한그대로117661ms에완료했다. 첫4파일병렬실행의timeout은단독실행에서재현되지않았다. 병렬부하의영향으로추정하며최초실패를삭제하지않는다.

전체52개root/file 결과의최종중복제거집계는751개성공이다: 첫692에서교체한실패root3개와coachContent중복하위41개를빼고재검증103개를반영한다. 이표현은한번의전체실행이751/0으로끝났다는뜻이아니다. 첫전체689pass/2fail/1cancel을명시적으로보존한다. baseline705에새native30+handler16이더해진범위와일치한다. 기존4mock test와실제handler의인증/오류주입을모두순수native서버검증으로부르지않는다.

현재최종근거: 일반921pass/68skip/0fail, PG18pass/0skip/0fail,전체Mongo파일별751성공, typecheck/lint/buildPASS(lint기존경고7). 영향native30/handler16은전체Mongo에포함되므로추가합산하지않는다. 실제브라우저/실원천/운영복사·백업·복원·전환은미실행이다.

## 자원 정리 및 증거 보존

cleanup.log exit0. 소유PG의 data_directory와 public 객체0, 소유Mongo의 dbpath/replica명과 userDB0을확인한뒤정상종료했다. cleanup-verification.log에서소유pg/mongo데이터디렉터리부재와56729/27829포트닫힘을추가확인했다. 다른PG/Mongo서비스는건드리지않았다.

지속증거: `/Users/ga/.cache/hub-om-verification/20260930-import-staging` (최초실패·보완·최종로그/실행스크립트와sha256.json). source-digests.json의소스17개해시는최종검증이후동일하다. 운영/실원천/키env·배포·main/dev·원본workspace변경없음.
