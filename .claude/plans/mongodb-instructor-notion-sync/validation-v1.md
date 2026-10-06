Validation v1 — mongodb-instructor-notion-sync

판정: 구조 PASS. 현재 `feature/20260929-mongodb-instructor-notion-sync`의 요구사항·plan-v1, 원본 sync/map/route와 기존 MongoInstructorNoteRepository를 대조했습니다. 아래는 실행 수락 기준이며 구현·테스트 통과 판정은 아닙니다. 파일 수정·DB 접근은 하지 않았습니다.

S1. 태그 — PASS
5단계 모두 태그가 있습니다. Core 2개, Shell 1개, Check 2개입니다.

S2. Core 존재 — PASS
NO/legacy 매칭·순차 처리 계약과 Mongo 재매칭·원자적 저장을 핵심 단계로 분리했습니다.

S3. 조건·변환 프레임 — PASS
NO 일치 → 이름 exact이면서 notionNo=null인 legacy → 생성 순서가 명시됩니다. truthy notionId, recruitAvoid OR, 수동 필드 보존, dry-run/실반영, 행 실패/원천 실패의 분기도 결정 가능합니다. 구조 FAIL이면 결과 기준 평가는 중지합니다.

원본 대조에서 확인한 주의점

- “NO 없음”은 원천 NO 누락이 아니라 **해당 NO의 저장 행이 없음**입니다. 원천 NO를 읽지 못하면 매핑 단계에서 skip합니다.
- mapper는 NO의 타입이 number인지만 확인합니다. 양수·정수·Int32 조건을 새 skip 정책으로 추가하면 기존 오류 분류가 달라집니다.
- dry-run은 앞행의 가상 변경을 반영하지 않습니다. 같은 신규 NO가 두 번 오면 preview는 create 두 번, apply는 create 후 update가 될 수 있습니다.
- 기존 Mongo `save`는 전체 행을 재암호화해 replace합니다. 수동 필드의 논리값 보존과 ciphertext 동일성은 별개입니다.
- 기존 transaction은 30초 withTransaction을 최대 5회 재시도합니다. 이를 총 30초 deadline이라고 보고하면 안 됩니다.
- 잘못된 Bearer라도 관리자 세션이 유효하면 기존 접근 함수는 허용합니다. Bearer 불일치만으로 무조건 거부하는 정책은 추가하지 않습니다.

V1. 매핑·식별·순차 처리 계약

정의: 기준 `3dfa025`의 원본 PG oracle, 새 PG, Mongo를 동일 합성 입력으로 비교하여 허용된 비결정값·정제 오류를 제외한 미설명 불일치가 0건이어야 합니다.

필수 사례:

- NO 일치 행이 있으면 이름이 달라도 해당 행을 갱신합니다. 이름이 같은 legacy가 있어도 NO 행보다 우선하지 않습니다.
- NO 행이 없을 때만 이름 exact+notionNo=null 행을 연결합니다. 동명이지만 다른 NO가 있는 행은 연결하지 않습니다.
- 이름 변경, 이름의 대소문자·공백 차이, 같은 이름의 다른 NO, 조건부 notionId를 검증합니다. page.id의 기존 하이픈 제거도 유지합니다.
- 이름 누락·빈 이름·NO 누락/타입 오류는 skip, mapper가 수용한 비정상 number는 실PG에서 dry-run/apply 각각의 오류 단계와 분류를 확인합니다. 0·음수·소수·Int32 경계를 임의 정책으로 정리하지 않습니다.
- recruitAvoid의 false/true 조합 4개를 검증하고, displayName/notes/partnerId의 null·빈 값·기존 값을 보존합니다. profile은 병합이 아니라 기존대로 대체하며 syncedAt도 대조합니다.
- 연락처·이메일·생년월일 제거와 memo/feeNote의 기존 패턴 가림을 독립 기대값으로 검증합니다. 이를 모든 자유문자열의 PII 제거 보장으로 확대하지 않습니다.
- 원천 페이지 순서·중복 NO·같은 이름의 다른 NO를 유지합니다. 행 실패 뒤 다음 행을 처리하며, 정상 종료 시 `created+updated+skipped+errors=totalRows`여야 합니다.
- preview의 coachName/action/details와 배열 순서를 원본대로 비교합니다. apply에서 changes가 생략되는 계약도 유지합니다.
- 재실행은 중복 생성 방지와 기존 updated 집계를 검증합니다. “재실행이면 updated=0”이나 “감사 없음”을 새로 요구하지 않습니다.

복수 legacy 동명 행에는 원본 orderBy가 없습니다. 선택 가능한 기존 행 중 하나만 연결되고 나머지가 보존되는지 판정하며, backend 간 동일 행 선택을 강제하지 않습니다.

근거: Core1 및 NO 우선·수동 값 보존·부분실패 요구. Oracle은 새 workflow/helper를 공유하지 않고 원본 매핑·저장 분기를 고정합니다.

V2. Mongo 행 원자성·경합·암호화

정의: 각 동기화 행은 최신 상태에서 재매칭하여 업무 변경과 ActivityChange를 함께 commit하거나 함께 rollback해야 합니다. 별도 행의 성공 commit은 유지합니다.

필수 사례:

- 실제 manual writer와 sync writer를 barrier로 겹치게 하여 displayName/notes/partnerId 갱신 유실 0건을 확인합니다. 같은 문서 쓰기가 겹치는 사례에는 실제 conflict/retry 증거가 필요합니다.
- recruitAvoid는 retry 후 다시 읽은 값과 원천 값의 OR로 계산합니다. 단, 수동 writer가 나중에 false를 쓰는 정상 직렬 결과까지 금지하지 않습니다.
- 동일 신규 NO 동시 생성, 동일 NO 갱신, 같은 legacy를 서로 다른 NO가 연결하려는 경합을 검증합니다. NO 중복·이미 연결된 legacy의 잘못된 재사용·retry 감사 중복은 FAIL입니다.
- 행 A 성공 → 행 B 후행 감사 실패 → 행 C 성공을 구성합니다. B의 문서/HMAC/timestamp/ActivityChange는 원복되고 A/C는 유지되며 집계가 이를 반영해야 합니다.
- 이름 exact 조회는 HMAC 후보 조회 후 원문을 확인합니다. 키 오류·HMAC 불일치·암호문/profile 손상은 해당 행 실패로 처리하고 그 행에 쓰기를 남기지 않습니다.
- 기존 개인정보 저장 정책에 따라 이름·수동 메모·profile·감사 actor 등의 평문 비노출을 확인합니다. 감사 공개 필드와 redaction은 실제 PG trigger를 기준으로 대조합니다.
- dry-run 전후 InstructorNote·ActivityChange·guard·counter의 변경은 0건이어야 합니다. 실제 GET의 ActivityRequest 기록은 업무 쓰기와 구분하여 허용합니다.
- 기존 save의 재암호화로 ciphertext가 달라지는 것은 논리값 유실로 판정하지 않습니다. 반대로 raw 값이 달라도 된다는 이유로 수동 필드의 논리값 변경을 허용하지 않습니다.
- 기존 일반 saveNote/saveNoteByNotionNo의 의미를 바꾸지 않습니다. 특히 일반 이름 저장의 별도 우선순위를 sync의 legacy 매칭에 재사용하면 FAIL입니다.

근거: Core2와 기존 Mongo transaction/save/audit 구현. PG의 순차 read/update 경합 한계를 이번에 수정할 의무는 없으며 Mongo 강화와 구분합니다. 재시도 횟수·시간 예산은 실제 구현대로 기록하고, unique 오류를 무한 재시도하지 않습니다.

V3. 실제 API·원천 경계·오류 안전성·완료 증거

정의: 실제 GET/POST에서 권한·두 port 선택·원천 페이지 수집·응답 계약을 검증합니다. 비인가 업무 접근, 명시 scope의 PG/실외부 fallback, 오류 개인정보 노출은 모두 0건이어야 합니다.

필수 사례:

- 세션 공급만 mock하고 실제 requireInstructorSyncAccess·assertAdminSession·withActivity를 호출합니다. 정상 Bearer, 관리자 세션, 잘못된 Bearer+관리자 세션, 비관리자를 구분합니다.
- 기존 syncJsonResponse의 성공/실패 status와 GET `{ok,dryRun,result}`·POST `{ok,result}` 형태를 유지합니다. 일반 admin GET의 403 정책을 이 route에 옮기지 않습니다.
- instructorNotionSync와 instructorNotionSource를 모두 해결한 뒤 readPages를 호출합니다. 어느 port든 누락되면 원천 호출·PG 호출·업무 쓰기는 0회여야 합니다. requestActivity 누락도 업무 실행 전에 차단됩니다.
- 기본 PG/default source의 기존 선택을 보존하되 실제 외부 접속 없이 fetch 대역으로 페이지 크기 100, start_cursor, has_more/next_cursor 종료 조건과 페이지 순서를 검증합니다. 원천 반환을 임의 dedupe하지 않습니다.
- 첫 페이지 성공 후 후속 원천 실패 시 업무 반영은 0건이어야 합니다. 원본은 전체 페이지 수집 후 저장을 시작하므로 페이지별 선반영으로 바꾸면 FAIL입니다.
- 원천 오류와 행 오류는 유한한 고정 코드로 정제합니다. 이름·원천 body·driver message·키를 error/errorDetail/로그에 포함하지 않습니다. 인가된 preview의 coachName/details는 별도 계약으로 유지합니다.
- 행 오류는 errors/errorDetail에 반영하고 다음 행을 계속합니다. 원천 실패는 전체 실패로 처리합니다. 요청감사 후행 실패는 업무 결과를 뒤집지 않고 고정 로그만 남겨야 합니다.
- 소유 합성 PG/Mongo에서 oracle/native/actual handler 증거를 확보하고 기존 Mongo 저장소 회귀·전체 test/typecheck/lint/build를 연결합니다. 실패·skip·미실행은 PASS가 아닙니다. cleanup·commit/push·통합 SHA는 기능 검증과 별도 인계조건입니다.

근거: Shell·Check 단계와 원본 fetchAllNotionPages/route/withActivity 계약.

계획 보완 권고

1. Core1의 “NO 없음”을 “해당 NO의 저장 행 없음”으로 명확히 표기합니다.
2. 원천/행 오류 코드 목록과 적용 위치를 고정합니다. 공통 syncJsonResponse 변경으로 다른 동기화 정책까지 바꾸지 않습니다.
3. 기존 30초×최대 5회 재시도와 수동 필드의 논리값 보존을 명시하여 총 deadline·raw ciphertext 보존으로 오해하지 않게 합니다.

구조는 적합하며 추가 제품 결정은 필요하지 않습니다. 위 기준으로 독립 메타 검토를 진행할 수 있습니다.
