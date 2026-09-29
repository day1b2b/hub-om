# 강사 Notion 실행 검토

기준3dfa025,계획v2/검증v2. 기능구현·실행검증·독립수락·소유자원정리완료. 원격통합은handoff/integration-review를따른다.

## 실행 증거

모든로그root `/private/tmp/hub-om-instructor-notion-20260929/logs`.

|검사|최종결과|증거|
|---|---|---|
|일반전체|905pass/54skip/0fail,exit0|unit.log;skip은opt-inDB등이며PASS아님|
|전체Mongo묶음|532pass/0skip/0fail/0cancelled,exit0,365914ms|mongo-bundle.log;mock4포함|
|실PG원본/newPG/Mongo|5pass/0skip/0fail,exit0;각123상황(41xpreview/apply/reapply)|pg-parity.log;45migrations/원본mapper·PII·oraclechecksum|
|해당Mongo native|최종묶음25pass|동일profile/nullable감사·manualidentity포함. 초기단독native-fixed22pass뒤3case추가,최종묶음에서모두실행|
|실제GETPOST|10pass|handlers.log 및전체묶음;authsession만mock,실guard/context/factory/repository/audit|
|원천·workflow|3pass|workflow-fixed.log 및일반전체;실외부fetch금지/합성응답만|
|typecheck/build|PASS exit0|최종static 전체exit0/typecheck.log/build.log|
|lint|오류0,기존경고7|lint.log에서새testunused경고1발견후인자만제거;해당파일lint-handler-final.log exit0|

서로겹치는테스트묶음은합산하지않는다. 일반skip54와실DB532는동일모수아님. 실제PG17.9/Node24.19.0/Mongo8.0.30,운영PG18미실행.

## 의미 검증

V1: 원본동결oracle와새PG/Mongo가번호우선/legacy/동명다른NO/이름변경/conditionalID/profile대체/수동null·빈값·기존값/OR4조합/중복원천/skip/행오류/재실행의응답·논리row·actual감사를동일하게냈다. numeric15입력의새행/legacy,소수절단과Int32범위/Nan/Infinity분류를대조했다. 생성UUID/실행시각만명시적으로정규화,fixtureID/createdAt/NO/배열/실패수유지. 논리row에서companion분리하되raw5개HMAC를독립createHmac로검증.

V2: 실제manual saveNote/saveNoteByNotionNo양방향barrier의실WriteConflict112/retry,동일NO최초insert·legacy서로다른NO·manualNO이동/최초upsert의재매칭과감사중복없음확인. 실제감사insert후실패및validator거부에서업무/HMAC/timestamp/감사함께rollback,다른A/C행성공유지. key/HMAC/profile손상과숨겨진legacyHMAC/wrongindexkey에서무쓰기·고정오류. dryrun업무/guard쓰기없음. 원본PG실측감사차이는sync-only helper로보완해exact대조통과.

V3: 실제GETPOST의secret/admin/잘못된bearer+admin fallback·미인가500/부분실패200·actor귀속·응답형식유지. 3필수scope누락시source/PG0,실외부fetch0,초기화빈/skip/정상모두같은실패phase. sourcepagination/config/JSON/network실패시초기화/업무0,mapper후행실패앞행commit유지. 원천/body/token/driver/mapper오류정제와인가된preview이름분리. 요청감사실패는업무성공유지/고정로그.

## 실패·수정 이력

- 조사중추정경로rg exit2: rg--files로실경로확인후재조회. 제품실패아님.
- 숫자probe 최초agent fork EPERM:DB검증미실행. 메인이동일스크립트/소유DB에서exit0확인. agent측권한대기로PG최종test작성미완료→중단하고메인이직접작성·실행했다. 운영접속없음.
- workflow처음2pass1fail:emptySyncResult의changes:undefined ownproperty를기대에서빠뜨림. fixture수정후3pass.
- native첫18pass2fail/진단20pass2fail: -0.5의negativezero형태문제(숫자case1+parent실패). 제품보완후22pass,최종추가3case포함25pass. 초기로그보존.
- 중간독립P2 HMAC부재오인/감사PGparity 및수정은gap-plan과intermediate-review.
- PG첫3pass2fail:원본/newPG123상황PASS, Mongo논리row에저장companion까지포함해불일치. companion을DTO비교에서분리하고raw HMAC검증추가후5pass. 최초콘솔실패근거는세션기록,pg-parity.log는최종실행로그다.
- 최초전체static904pass53skip/type/buildPASS. 이후PGtest·감사보완의새변경때문에최종static재실행905pass54skip/type/buildPASS. 새lint unused경고1은testnoop인자제거후해당파일검사PASS. 동일제품에전체Mongo재실행안함.

## 한계

실Notion/운영DB/브라우저/생산앱Mongo구성/운영PG18/대형scan부하/복사·복원·cutover는미실행. 같은이름동시최초생성은별도행가능,후행manual명시false/profile쓰기허용,복수legacy승자는미정. Mongo snapshot강화와원본PG순차조회한계구분. 시도별30초x외부최대5회,전체30초보장아님. HMACfallback은관련없는legacy손상/20k/32MiB/15초한도에도failclosed. 빈DB키정당성/후보존재시숨겨진중복검출보장없음. 원본매핑가림범위와전체자유텍스트PII제거는구분.

Gibbs 최종독립V1–V3 PASS,미해결P0–P3없음(independent-final-review.md). 메인은최종static session97980의실제exit0도확인했다. 리뷰시점종료코드미확인주의와구분한다. cleanup session81548 exit0,남은합성DB0,소유PG56689/Mongo27789정상종료및두dbpath부재확인. 로그·스크립트보존. 원격SHA는integration-review를따른다. 생산PG·전체이전/dev→main미완료.
