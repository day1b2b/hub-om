# Validation v2

Carver의C1~C6과Parfit메타6보완을계속적용한다. 먼저Core존재·결정성·변별력·추적성을평가한다. 아래기대결과에어긋나면실패이며시나리오/기준을약화하지않는다.

| 규칙/원본 함수(동결SHA는original-digests) | 계획 | 기준·fixture 및 기대 |
| --- | --- | --- |
| promoteReadyImportRows/buildPromotionCandidate | §2 | C1: valid/mixed/Notion/없는run/연결만/201행, summary회계·차단우선순위·전체행 exact |
| fingerprint/business-key/find/link | §2~3 | C1/C3: 활성/삭제·지문없음·prefixcollision·다른팀/날짜/과정, 원본3방향비교; §3barrier표의각허용결과 |
| company/courseupsert/buildOperationSessionValueData | §4 | C1/C2: defaults/nullable/금액반올림±half/overflow/invaliddate/enum/Unicode; 실제쓰기후후반오류시raw전체동일 |
| PGtrigger/withActivityDatabase | §4 | C2: Company/Course/OperationSession 감사target/action/actor/request/필드집합·부재null exact, sourceaudit0, 민감raw0. no-op/cipher rerandomization 의미별도 |
| Course.processSeq/defaultnextval | §4 | C3/C6: highwater/maxstored/최대삭제/미사용sequence/rollback/재시작/고갈/공유writer barrier. 값열차이만제외하고다른업무필드차이삭제금지 |
| actualPOST/withActivity | §1/5 | C4/C5: 실제guard·scope선검사·PG/fetch0, commit전/불명/후·Calendar실패·revalidate실패·감사실패를§5표대로판정 |
| backfillMissingCalendarEvents 호출 | §5 | C4/C5: 빈결과도옵션exact, callback/ACKretry중0·ACK확정후1·사용자재요청은다시1, Calendar실패는200/calendar생략 |
| Mongo준비/transaction/codec | §3~5 | C2/C6: validator/index/guard/counter미준비write0/자동수리0, HMAC/cipher/key손상민감오류0,15초/20k/32MiB/전체60초·retry예산비초기화 |
| 사용자전체목표 | §6 | C6: 일반/type/lint/build/전체Mongo/독립수락/소유정리/commitpush총괄SHA, 생산PG유지·실백업증거0 |

의도된 차이: 비정형 예외 고정 문구, Mongo 기한/scan 안전 한계, PG nextval 결번과 Mongo transaction counter. 추가로 아래 자연키 경합 시나리오에 한정해 Mongo 결과를 실제 원본 PG의 허용 직렬 결과 전체와 비교한다. 특정 동시 일정의 PG 두 건/Mongo 한 건 차이를 정규화로 지우지 않으며 현재 실행·독립 수락 대기다. 비교 예외는 이 명시 항목에 한정한다. 원본 업무 응답·권한·삭제 정책을 개선 명목으로 바꾸지 않는다. V2에 없는 차이를 발견하면 새 근거로 계획/검증을 보완하고 기록한다.

원본fixture는신규core를공유하지않는다. generatedUUID는유일성/참조검증후,시각은호출구간/순서확인후,generatedprocessSeq는유일성/기존최대보존확인후에만좁게정규화한다. JSON배열/키/로그/DTO순서와null은지우지않는다. 실패무쓰기판정은암호문·시각·ID포함raw그대로대조한다. 외부Calendar는합성effect만사용하며actualHTTP와native저장소를검증한다. 실제네트워크실패/프로세스crash와오류주입은구분하고skip/미실행PASS금지.

## 최종 결정성 보완

- 구현 중 추가된 자연키 경합은 같은 기업/과정·다른 날짜와 동일 업무키를 구분한다. 실제 PG 동시 결과와 PG 허용 직렬 결과, Mongo 경합 결과의 summary·source 참조·값·감사를 각각 보존한다. 같은 업무키 PG 경합 두 건과 Mongo 재조회 한 건의 차이는 정규화하지 않는다. 정확한 insert 위치/keyPattern/keyValue만 재시도하고 다른 unique/감사/commit 실패는 재시도하지 않는지 검증한다. 이 보완은 실행 수락 대기이며 전역 직렬화·항상 한 건 생성 보장을 추가하지 않는다.

- 동일run 재실행/경합은 전부eligible fixture에서만 후행sourceRows0이다. mixed/all-blocked는원래blocked행/이유를남기며추가업무·변경감사0이다. 성공POST마다Calendar는한번이다.
- business-key 다중후보는원본findFirst에orderBy/courseId/sourceTeam/roundNo조건이없다. 허용후보중하나에연결,추가생성0,실제선택대상참조/summary를검증한다. 특정UUID를공통정답으로만들거나임의정렬/무조건정규화하지않는다.
- linkSource 두번째값은OperationSession UUID id다. forceChangedFields는PG실제감사필드만이고source감사는추가하지않는다. 60초는업무예산/관찰점검사이며roster취소/POST전체시간보장이아니다.
