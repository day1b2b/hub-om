# Core 결정 규칙 보완

원본 조건표는 source-findings.md의 각 bullet을 분모로 하며 validation-v2의 R→V→T11..T45 다대다 추적표로 검증 연결한다. 구현 wiring은 Shell로 별도 구분한다.

## 금액

실 PG17.9/Prisma7.10 합성 probe logs/numeric-probe-fixed.log exit0: 1.005→1.01, -1.005→-1.01, 2.675→2.68, -0→0, 1e-7→0, 999999999999.99 유지, 999999999999.995/1e12 거절. NaN/±Infinity는 Prisma number 전달에서 revenue null, raw는 String(number). 원본 안전성 개선을 이 전환에 혼합하지 않고 이 동작을 별도 parity 검증한다. 첫 probe는 임시 PII 키 누락으로 실패, 코드내 randomBytes 합성키 설정 후 성공. 운영키 조회 없음.

유한값은 String(number)의 부호/정수/소수/지수를 분리해 BigInt cents로 변환, 나머지*2>=제수이면 절대값 올림, 부호 재적용(0은 양수), abs(cents)>=10^14이면 실패. 기존 관리자 numericMoney를 shared helper로 추출하고 기존 오류코드는 adapter에서 유지. 비유한값은 매출 sync adapter에서만 null로 처리한다. 응답과 비교는 원 number, revenueRaw는 String(number) 유지. 결과적으로 1.005 재실행도 change이며 NaN after는 JSON HTTP에서 null이 되는 원본 결과를 보존한다.

## snapshot/경합/감사

pending은 최초 조회 기준 고정(원본). 감사 before만 transaction 내 실제 최신행이며 반복 pending은 앞선 같은 transaction 쓰기를 관찰한다. revenue/revenueRaw/updatedAt만 patch, codec은 전체 인증행 검증. `operationAuditRow`의 논리 변경 비교를 사용: updatedAt만 변경이면 감사 없음, revenueRaw 변경은 redacted, revenue는 actual before/after 숫자. PG실측과 다르면 sync 범위 helper만 보완한다.

드라이버 withTransaction은 원본 오류 metadata를 받은 상태에서 TransientTransactionError/UnknownTransactionCommitResult 처리. applyUpdates 시작부터 deadline120초(원천·최초조회·별도log 제외), snapshot+majority+j, 콜백 외 source/계산/log/알림은 재시도하지 않는다. 상위에 별도 duplicate-key 재시도 없음(생성 업무 없음). 바깥 경계에서만 안전 오류로 치환. 확인된 abort이면 전부 rollback, 예외이면 후속 sync log 없음. 커밋결과 불명확(UnknownTransactionCommitResult 기한초과)은 commit/abort 단정불가; 안전오류로알리고 결과확인필요. 오류알림의 기존값보존단정은 이경우오해를막도록 결과확인안내로 교체. 신규/코스ID이동/복원이 읽기 이후 추가한 Course는 원본처럼 이번 pending에 없음. 동시 생성 즉시 일관/수동매출 우선권을 새로 약속하지 않으며 공통guard 확대 제외. source audit의 재계산 권고는 원본 의미 변경이므로 채택하지 않음.

## 포트·오류·순서

필수 scope: salesRevenueSync, salesRevenueSource, salesRevenueNotifier, requestActivity. route에서 notifier를 업무 앞에 해결, facade에서 repo/source를 원천 앞에 해결, withActivity는 requestActivity를 handler 앞에 해결. 기본 repo 생성은 PG 초기화하지 않고 listCourses 시점에만 초기화. source.isConfigured=false면 source.read0/DB0, configured=true reader.disabled는 원본처럼 failed가 아니므로 조회/계산 진행.

알림 조건 cronPOST&&(!configured||!applied||throw), 그외0. notifier 실패는 삼키며 API/업무에 영향0. notifier port 누락 자체는 업무/source이전500이고 알림0. 기본 notifier만 기존 env대상/명단/Slack를 사용, explicit scope에서는 기본생성·호출0.

오류: facade/source/repository의 throw→SALES_REVENUE_SYNC_FAILED(예외원문 없음), source reader catch→고정 세일즈맵 읽기실패 안내, route catch→SALES_REVENUE_SYNC_FAILED. source issues는 알려진 code+정해진 메시지형식만 보존, 미지/형식불일치→SALES_REVENUE_SOURCE_ISSUE. 정상 disabled/partial고정 안내 유지. 정상 preview 이름/원코스ID·금액을 숨기지 않는다. 입력 body 파싱과 인증 정책은 변경하지 않는다.

PG 무정렬 대응: source순서/중복/pending순서 보존. backend복수 Course 행의 changes는 각 source구간 안에서만 (courseName,companyName,before,after,action)의 multiset대조. multiDealCourseIds의 companyName/courseName은 각 backend listCourses의 첫 매칭행과 exact대조하며 backend간 그 두 필드만 허용차이. 정상 단일매칭은 응답전체exact. UUID/생성시각만 생성값정규화, fixture식별자/createdAt 유지. 이를 완전동일응답으로 과장하지 않는다.


## 최종 보완: 오류 형식·순서·경합 절차

허용 issues(code→전체메시지 정규식): salesmap_deal_missing_amount→^금액이 없는 딜 [0-9]+건을 건너뛰었습니다\.$; salesmap_deal_non_positive_amount→^합산 금액이 0 이하인 코스ID [0-9]+건을 제외했습니다\(환불 등 확인 필요\)\.$; salesmap_deal_pagination_truncated→^딜이 많아 일부만 읽었습니다\(최대 [0-9]+페이지\)\. 전체가 반영되지 않을 수 있습니다\.$; salesmap_cursor_loop→원본 고정문구 exact; salesmap_api_token_missing→Salesmap reader is not fully configured. exact. salesmap_read_failed→고정 `세일즈맵 딜을 읽지 못했습니다.`(원문무시). 그외/형식불일치→SALES_REVENUE_SOURCE_ISSUE. 안전문구는source업무응답/synclogdetail/Slack에같이사용한다.

withActivity requestActivity선해결(누락시handler이전reject, 직접GETPOST호출에서는Response500반환아님)→actor기록→handler의auth(거절403)→notifier선해결→facade repo/source선해결→source설정/읽기. 나머지3port누락은인가handler에서500, source/업무/알림0. 기본PG no scope 유지.

경합1 same후수동: listCourses 반환직후(snapshot읽기transaction종료후)barrier→실admin revenue수정commit→해제→workflow pending0/unchanged1/updatedRows0, sync변경감사0. 경합2 pending이미목표: 같은조회후barrier→실admin목표revenue 및raw를합성직접준비(최종목표raw일치조건분리)→해제→updatedRows1/changed원본, 최신revenue/raw둘다같으면sync감사0,raw만다르면redacted감사1. 경합3 duplicate pending 충돌: applyUpdates 첫번째쓰기전 최신row반환barrier(아직쓰기lock없음)→실admincommit→해제→realwriteconflict/retry→중복순서/updatedRows2유지, 시도실패감사0. 중간pending후감사실패는실insert후throw로rollback대조. 반대순서는sync를먼저commit한후대기중manualread를해제해retry/최신무관필드보존. 상대commit을기다리며같은row쓰기lock보유하는barrier금지.
