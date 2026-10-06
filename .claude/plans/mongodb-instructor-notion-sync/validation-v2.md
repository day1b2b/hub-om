Validation v2 — mongodb-instructor-notion-sync

판정: 검증 기준 수락. 계획 작성 시 numeric PG 판정표는 실측 대기였다. 이후 numeric-findings/pg-parity.log에서 원본/newPG/Mongo 각123상황을 확인했고 해당 동등성은 실행 검증 PASS다. 파일 수정·DB 실행은 하지 않았습니다.

S1. 태그 — PASS: Core 2개, Shell 1개, Check 2개.
S2. Core 존재 — PASS: 식별·순차 처리와 Mongo 재매칭·원자성을 분리했습니다.
S3. 조건변환 — PASS: NO 조회→null-NO legacy→생성, 조건부 ID·OR·수동값 보존·실패 분기가 명시됩니다. 구조 FAIL이면 결과 평가를 중지합니다.

V1. 원본 매핑·식별·순차 계약

원본 PG/newPG/Mongo를 독립 oracle와 비교합니다. 생성 UUID·실행시각만 지정 위치에서 정규화하며 fixture ID·NO·수동값·배열 순서·실패 행 위치는 유지합니다. 원본 mapper와 stripPii도 동결하거나 원본 해시로 보호합니다. 새 workflow/matcher로 기대값을 생성하면 FAIL입니다.

| 구분 | 필수 사례와 수락 조건 |
|---|---|
| 정상 1 | 해당 NO의 저장 행 우선, 없을 때만 이름 exact+NO null 연결, 그마저 없으면 생성. 동명 다른 NO는 보존 |
| 정상 2 | 이름/NO·truthy notionId·profile 전체/syncedAt 갱신, recruitAvoid OR 네 조합, 수동 3필드·createdAt 보존. 기존 stripPii 범위 유지 |
| 경계 | NO 판정표를 `0/음수/소수/Int32 양끝·초과`별 mapper→dry-run 조회→apply→집계·쓰기 결과로 분리해 원본 실PG로 확정. NaN/Infinity는 JSON 입력과 직접 주입을 구분 |
| 실패 1 | 신규 NO 검증으로 skip을 늘리거나, 실PG 미확정 결과를 Mongo 안전성 강화로 임의 승인하면 FAIL |
| 실패 2 | 원천 순서·중복 제거, dry-run 가상 저장, 재실행 updated=0 강제, 수동값 덮어쓰기, 미설명 집계/preview 차이는 FAIL |

정상 종료 시 `created+updated+skipped+errors=totalRows`입니다. 중복 신규 NO는 dry-run create 두 번과 apply create→update가 달라도 원본 계약입니다. 복수 동명 legacy는 허용 후보 중 한 행만 연결하고 나머지를 보존하며, backend 간 동일 승자를 강제하지 않습니다.

Numeric 판정표는 **실측 완료**다. numeric-findings.md와 execution-review.md의 실제 PG·Mongo 근거를 따른다. 계획 당시 미확정 항목을 임의 PASS하지 않고 실제 결과로 확정했다.

V2. Mongo 원자성·실제 writer 경합·암호화

각 행의 매칭·현재값·OR 계산·저장 document·감사 diff를 transaction callback과 retry마다 다시 계산합니다. 성공한 다른 행은 유지하고 실패한 행만 원복합니다.

| 구분 | 필수 사례와 수락 조건 |
|---|---|
| 정상 1 | 실제 `saveNote`/`saveNoteByNotionNo`와 sync를 양쪽 선행 순서로 겹치게 하고, 같은 문서의 실제 conflict/retry 및 요청별 감사 증거 확보 |
| 정상 2 | 동일 NO 최초 생성과 동일 legacy의 서로 다른 NO 연결 경합에서 재매칭 수행. NO 중복·선행 연결 탈취·중복 감사 0건 |
| 경계 | 후행 manual의 명시적 false/profile 쓰기는 직렬 결과로 허용. 같은 이름의 최초 생성은 서로 다른 행으로 둘 다 commit 가능함을 기존 한계로 인정 |
| 실패 1 | 이전 target/row/document를 retry 밖에서 재사용해 수동값·NO 연결을 유실하거나, collection 직접 수정만으로 manual 경합 검증을 대체하면 FAIL |
| 실패 2 | A 성공→B 후행 감사 실패→C 성공에서 B의 업무/HMAC/timestamp/감사가 함께 원복되지 않거나 A/C가 소실되면 FAIL |

키·HMAC·암호문/profile 손상은 안전하게 실패하고 해당 행 쓰기 0건이어야 합니다. 개인정보 저장·감사 정책은 실제 PG와 대조합니다. 특히 동일 profile 재암호화와 nullable create 감사 차이를 실PG로 확인하며, 자동으로 허용 차이로 처리하지 않습니다.

수동 필드는 논리값을 보존합니다. 기존 full-row 재암호화에 ciphertext 동일성을 요구하지 않습니다. 기존 retry는 시도별 30초·외부 최대 5회이며 전체 30초 보장은 필수가 아닙니다. PG의 약한 동시성 계약을 이번에 강화할 의무도 없습니다.

V3. initialize·실제 API·원천·오류 경계

필수 순서는 **두 port 해결 → 원천 전체 수집 → initialize 1회 → 행 처리**입니다. initialize는 행별 catch 밖에서 실행합니다. PG는 기존 getPrismaClient의 동기적 구성 확인만 수행하고 추가 연결·쿼리·설정 검증을 하지 않습니다. Mongo는 성공한 open 이후 no-op입니다.

| 구분 | 필수 사례와 수락 조건 |
|---|---|
| 정상 1 | 실제 GET/POST·권한 함수·withActivity 사용. 정상 secret, 관리자 세션, 잘못된 Bearer+관리자 세션 허용을 보존하며 새 secret 길이 제한 없음 |
| 정상 2 | 합성 fetch로 page_size=100·cursor·종료·순서 검증. preview 값/문구 유지, 행 오류 후 다음 행 진행·HTTP 200 유지 |
| 경계 | initialize 실패×빈 원천/전부 skip/정상 행 포함 모두 정제된 전체 500·업무 쓰기 0건. 원천 실패 시 initialize 0회 |
| 실패 1 | 어느 port든 누락인데 source/PG를 호출하거나, 후속 원천 페이지 실패 전에 업무를 반영하거나, initialize 실패를 빈 성공/행 오류로 바꾸면 FAIL |
| 실패 2 | 설정·fetch·JSON·mapper·DB·감사 오류의 단계가 바뀌거나 이름/token/body/driver text가 error/errorDetail/로그에 노출되면 FAIL |

오류 분류는 다음과 같습니다.

- 설정·첫/후속 fetch·JSON 파싱: 전체 source 실패, `INSTRUCTOR_NOTION_SOURCE_FAILED`.
- initialize: 전체 실패, 별도 고정 코드 명시 필요.
- mapper: 원본처럼 행 catch 밖의 전체 실패, 별도 고정 코드 명시 필요. 앞선 성공 행은 원본대로 유지합니다.
- 행 조회·저장·업무감사: `INSTRUCTOR_NOTION_ROW_FAILED`, errors 증가 후 계속 처리.
- 권한 거부: 기존 전체 500/admin 문구 유지.
- 요청감사 후행 실패: 업무 결과 유지·고정 로그.

GET dry-run의 업무·ActivityChange·guard 쓰기는 0건입니다. 기존 ActivityRequest 기록까지 금지하지 않습니다. Authorization 헤더가 있는 관리자 fallback 요청의 감사 actorType도 원본 `token_request`를 보존합니다.

필수 oracle/native/actual handler·회귀·typecheck/lint/build 증거를 연결합니다. 실패·skip·미실행은 PASS가 아닙니다. 정리·push·통합 SHA와 운영 전환 완료는 별도 판정합니다.
