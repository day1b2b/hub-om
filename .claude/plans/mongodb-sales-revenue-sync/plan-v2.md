# Plan v2

계획 상태: 독립 critic Turing 최종 수락 PASS. 제품 실행 검증은 별도 진행한다. 기준/제약은 clarify-result, 검증추적은 validation-v2의 R→V→T11..T45, 조건은 source-findings와 decision-rules를 이 계획의 규칙으로 포함한다.

Changelog: v1의 미결정 문구를 실PG 금액표/BigInt 알고리즘, 필수4port 선해결, 안전오류표, snapshot과쓰기감사 분리, 전체deadline120초, 순서차이 정확필드로 교체. Domain규칙 Core와 wiring Shell 분리. 원본 pending 재계산 권고는 거절(동작변경), 신규과정 경쟁은 원본한계 유지.

1. [Core] 원본 판단규칙 확정. source-findings의 상태9행(미설정/failed/정상preview/partialpreview/partialapply/정상empty/정상pending/업무실패/log실패), 필터·정규화·resolution충돌·다중동일/상이4mode·중복·복수과정·decimal 실측을 조건분모로 한다. oracle은 a52f191 salesRevenueSync.ts에서 IO만 주입하고 checksum 고정, 새로직 호출 금지. 수락: 각조건→T1 사례 연결, 응답/rows/audit/log 정확대조 또는 이름2필드순서차이 명시.
2. [Core] 저장/경합 규칙. 조회snapshot의 pending/응답고정, 쓰기시 최신row의 해당3필드 patch+actual감사, driverretry내재읽기. 업무와변경감사모두commit/rollback; 별도sync/requestlog실패는업무유지. finite금액은decision-rules rounding, 비유한null; codec정책변경0. 수락: T2 실제manualwriter 양방향/재시도, 중복pending중간충돌, same후수동·이미목표·행부재·감사insert후실패, 중간업무실패, 새매칭생성한계 증명.
3. [Core] 외부/보안 규칙. 필수scope선해결, auth/result HTTP/POST선택정책 원본보존; raw오류만정제; cron실패알림 조건·best-effort유지. reader기존집계/캐시/페이지의업무규칙변경0. knownissue문구형식허용외고정코드; 허용preview이름유지. 수락:T3 실제handler인증·scope4누락·source/driver/notify오류·외부fetch/PG0·raw로그/HMAC암호화검증.
4. [Shell] Core를 최소 interface/source/notifier/PG adapter/factory/context/facade와 MongoSalesRevenueSyncRepository로 구현. prepared shadow/replica만 open, 회사/과정snapshot읽기, 기존store boundedscan,120초 전체transaction. 금액helper기존관리자에서추출하고기존errorcode유지. 원본workflow계산을이동하고선택된IO만교체. 수락: 신규schema/deps없음, 원본PG쿼리·트랜잭션옵션유지, diff가현재범위뿐.
5. [Check] T1 원본/newPG/Mongo preview/apply/reapply(상태/매칭/숫자/500개상한), T2 실제Mongo정합성/경합/rollback/원본한계, T3 actualGETPOST/안전원천mock, T4 npm test/typecheck/lint/build 및모든Mongo 묶음. PG56699/sales_revenue_parity/Mongo27799/salesrevenue20260929, 새소유dbpath+random임시키+합성데이터,env-i. 전체검사실패/skip은PASS금지. 정상response는필드삭제없이대조; 복수Course구간만multiset, 해당multiDeal표시명2개는backend첫매칭명검증. UUID/생성시각만정규화. 수락: validation-v2 추적필수사례전부증거, 실패보완기록과독립최종리뷰.
6. [Shell] 실행manifest/review/gap(필요시)/alignment/handoff/coverage/macro/운영메모 갱신, 소유합성DB정상종료·경로정리. feature원격→총괄FF,제품동일성/원격SHA확인, main/dev미변경. 수락: required evidence/readablehandoff/clean상태, 전체운영이전미완료명시.
7. [Check] validation-v2 최종기준별 결과 확인, 독립리뷰 미해결0/필수미실행0일때 이 Task만완료. 검증한제품이총괄과동일하면동일회귀재실행하지않고문서통합만확인.

요구사항 추적: R1기존의미→Core1/T1, R2저장원자성/경합→Core2/T1T2, R3외부격리/개인정보/실API→Core3/T2T3, R4완료증거/제약/인계→Check5/7+Shell6/T4. side effects테스트의조회barrier는MongoOperationStore.one 반환직후/쓰기직전 collection.updateOne에걸며 Promise제어, 실제manualrepository updateCell와교차한다. 오류주입은둘째Course update 또는실ActivityChange insert직후throw. 같은method를mock성공대체하지않고실DB를실행한다.

최종 보완: 최초 독립 v2 FAIL5항목을 decision-rules 최종보완에 반영했다. abs(cents) 상한, applyUpdates기준120초/불명확commit, exactissue형식/실제scope실패phase, R→V→20test 추적, lock없는barrier 순서를 고정. 최종재심사결과는 plan-v1-review에 추가한다.
