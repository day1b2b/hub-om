# Validation v1 — Drive history read → page

입력: [clarify](clarify-result.md), [plan](plan-v1.md). 현재 사전계획 위임 산출물이며 상위 구현 지속 승인은 유지된다. 이 문서는 같은 세션이 작성한 검증 기준 초안이다. 독립 critic/architect 검토 및 실제 테스트를 수행했다고 주장하지 않는다.

## 구조 검증 — 결과보다 선행

- S1 태그: PASS(작성자 자체 논리검토). Plan Step1–8에 각 한 개의 Core/Shell/Check 태그가 있다.
- S2 Core≥1: PASS(자체검토). Step1,3,4,5 네 개다.
- S3 판단 규칙: PASS(자체검토). C1 scope→backend/error, C2 순서→허용집합, C3 값→DTO, C4 관계→반환/실패, C5 budget/codec→실패, C6 인증/preflight→조회 여부, C7 등록 composition→기존 거부를 명시한다. Core는 파일 존재/형식만으로 수락되지 않는다. PG collation/특수 take는 원본 관찰로 닫도록 지정했고 실행 결과는 아직 없다.
- 구조 종합: 작성자 자체검토 PASS; 독립 메타수락 PENDING. **구조 기준 FAIL이면 아래 결과 기준을 평가하지 않는다.**

아래 V1–V9는 모두 현재 NOT_RUN이다. PASS는 계획 문장 존재가 아니라 지정 실행 증거 전부를 만족할 때만 부여한다. 필수 증거 누락은 PENDING이며 최종 수락 불가; 기대와 다른 관찰은 FAIL이다. skip은 PASS가 아니다. 각 기준의 필수 하위 케이스는 AND 조건이다.

## V1 — 원본·환경 증거 독립성 (R6,R7 / C8,C9)

입력: 수락·통합된 Calendar baseline, frozen original closure, 동일 synthetic fixture, 원본/current/native 별도 worker.
PASS: 원본 roots와 모든 runtime local import의 manifest hash가 일치하고 current 제품 탈출 0. 실행하는 ts-loader/package-lock/schema/필요 migrations도 고정. 원본과 current helper/expected builder 공유 0, 고정 literal full DTO의 근거 필드가 동결 원본에 추적된다. fixture seed와 제품 writer 증거를 구분한다.
실패 변별: current import 경로를 한 곳 주입하면 closure 검증 실패해야 한다. loader 1byte 변경은 실행 전에 거부해야 한다. 이것은 별도 합성 복사본의 negative test이며 원본을 변경하지 않는다.
증거: closure-manifest/hash 결과, worker별 source SHA/명령/exit, endpoint allowlist와 실제 소유 환경 확인, fetch tripwire 0. 실제 Google/Drive/Notion 또는 운영 DB 접근이면 FAIL.

## V2 — 기본 PG 및 scope 선택 (R1,R2 / C1,C6,C7)

필수 케이스: 기본 PG 양 메서드 정상; DATABASE_URL 없음; 실제 조회 실패/복호화 실패/변환 실패; scope={}와 drive만/teamMembers만; complete read scope; 명시 scope+DATABASE_URL 유무 두 경우; 동시 다른 scope 요청.
PASS: 기본 PG 실패는 frozen 원본처럼 null이며 새 예외가 밖으로 나오지 않는다. 명시 Mongo는 env와 무관하게 해당 repo만 사용한다. 누락 scope는 고정 실패이고 PG/local/Notion 호출 0. page는 auth 완료 후 양 repo 선택이 끝나기 전 데이터 호출 0. 각 명시 요청이 상대 namespace/결과를 받으면 FAIL.
등록 Calendar: 기존 complete bundle 경로 회귀 통과, 등록 object를 일부 복사한 scope는 기존 CALENDAR_SCOPE_MISMATCH로 callback 시작 전 실패. 새 read-only scope 시험은 Calendar 전체 조립 완료 증거가 아니다.
증거: actual facade/page 호출과 호출 카운터·tripwire; 기본 경로의 실제 PG 결과. 스텁 반환만으로 native 수락 금지.

## V3 — 최신·250·동률·인자 (R1,R3 / C2)

필수 케이스: (a) 오래된 성공 vs 최신 pending/error, (b) 최신 run 결과0 vs 과거 결과 있음, (c) 단건 run 시간과 result 생성시간 역전, (d) 0/1/249/250/251개, (e) 같은 run.startedAt 및 단건 두 키 동률, (f) 249개 우선행+경계 동률3개, (g) 동률 없는 한글/대소문자/악센트 등 PG collation, (h) 생략·0·1·249·250·251·-1·-250·소수·NaN·Infinity·큰 수 인자, (i) operationId 대소문자/공백 변형과 soft-deleted 운영.
PASS: 비동률 전체 DTO/배열 순서는 literal 및 실제 frozen PG와 deepEqual. 동률은 Plan C2의 완전한 후보 DTO 또는 경계 집합과 수량/중복 여부를 판정한다. boundary fixture는 상위249 전부 + 동률3 중 하나만 허용한다. run 정보와 다른 run 결과를 섞으면 FAIL. 동률 안 임의 한 순열만 PG 정답으로 고정하는 oracle도 FAIL.
원본 특수 take·collation의 actual PG 관찰 자료 없이 JS 추측 또는 새 clamp를 적용하면 FAIL. 문자열 collation 미지원이 발견되면 해당 V3는 수락하지 않으며 계획의 기술 gap을 닫는다.
증거: PG effective collation/Prisma 버전, 입력 행과 허용집합 정의, original/current/native full DTO. 최신 status를 건너뛰거나 take 전에 다른 필터로 행을 버리는 구현을 잡는 반례를 포함한다.

## V4 — DTO 전체와 원본 JSON 변환 (R1,R3 / C3)

필수 케이스: 네 원본 interface의 모든 field, nullable 텍스트/날짜/완료시간, DB null/JSON null, 후보 [null,false,0,"x",{},[],중첩object], 이슈 [null,3,"",문자열], 서로 다른 저장 카운터와 표시 결과 수, operationSessionId null/soft-delete에도 남는 이력 snapshot 이름.
PASS: literal full DTO와 frozen PG 및 current PG/native 결과가 일치한다. property insertion order만 다르면 PASS, 배열 순서/빈 문자열/null/누락키/날짜·카운터가 다르면 FAIL. 후보의 현재 truthy-object 필터를 새 schema validator로 바꾸지 않는다. 카운터를 250행 합계로 재산출하면 FAIL. 필드 일부 summary 대조만 있으면 수락 불가.
증거: seed 입력과 independent literal, worker별 전체 DTO 차이 보고. raw DB 문서의 DTO 유출용 canary metadata가 반환되지 않는지도 확인한다.

## V5 — 부모·snapshot·실패 구별 (R4 / C4)

정상: run+result+session 참조, nullable session, 존재하는 soft-deleted session, run만 있고 results0, 전체 run0. null session은 오류가 아니다.
반례: 단건 고려 후보의 missing run, 더 오래된 orphan과 더 최신 정상 후보 혼합, 선택 run 결과의 non-null missing session. 모두 명시 Mongo 고정 실패여야 하며 null/부분 DTO/다른 결과로 대체하면 FAIL. run0에서 run 조회 null은 허용하며 무관한 orphan 전수감사로 의미를 확대하지 않는다. 단건 operationId 자체가 없으면 null.
snapshot: 실제 native 두 session의 제어된 interleaving으로 run 시간/결과 변경 전후를 만든다. 반환은 하나의 같은 snapshot 완전 DTO여야 한다. 존재하지 않았던 run/result 혼합 tuple은 FAIL. PG의 불가능한 FK 상태는 Mongo fault-injection 증거로 표시하며 실제 PG에서 재현했다고 주장하지 않는다.
증거: actual native repository 결과, interleaving barrier 기록, 조회 전후 raw 상태 동일. 관계 검사 stub만으로 PASS 금지.

## V6 — PII·raw 오류·resource boundary (R4,R6,R7 / C1,C5)

실제 codec 보호 필드마다 synthetic marker를 seed한다. raw encrypted storage에는 보호 필드 marker 평문 0, DTO에는 원본과 같은 승인된 값이 있어야 한다. codec/HMAC companion/metadata/key material은 DTO/진단에 0. 잘못된 key/cipher/tag/필수 companion/policy, driver Error 및 MongoServerError에 canary URI/개인값을 넣어 고정 오류 외 노출 0을 확인한다. error injection은 실제 driver 장애와 별도 라벨이다.
기존 registry에 없는 snapshot 회사/과정 이름은 암호화되었다고 주장하지 않는다. 현재 policy 변경 없음 및 전체 PII 전환 gap을 기록한다. 저장 result.error 표시와 새 runtime raw-error 누출은 따로 검사한다.
자원: scan 및 호출 누적 한계 각각 정확 경계/초과를 테스트한다(20,000행,32MiB,scan15초/호출60초). 실제 BSON bytes를 계산해 byte 경계를 만든다. 시간 주입 검사는 주입이라고 라벨링하고 native 성공/실패 증거와 구분한다. 초과 시 null/잘린250행이 아닌 고정 실패, 종료 뒤 열린 cursor/session 0. deadline 재시작 금지.
증거: codec raw 검사, 실제 native read, sanitizer exact allowlist 테스트, elapsed/deadline 실패, read 전후 문서·감사 write delta=0. 명시 synthetic prepare/index/metadata/test seed/cleanup은 이 runtime write delta에서 분리해 허용한다.

## V7 — 실제 페이지 사용자 의미 (R2,R5 / C6)

사용자 시나리오: 인증된 운영자가 가장 최근 저장 run의 후보·이슈를 기존 화면에서 보고 운영 링크를 연다. 원천을 다시 조회하거나 운영값을 수정하지 않는다.
실제 `drive-import-runs/page.tsx`를 호출/렌더한다. auth platform 입력·Next redirect/Link 등 필요한 harness 경계만 교체하며 page나 presenter 자체를 fake 구현하지 않는다. original 페이지도 frozen closure에서 비교한다. 저장소 full DTO는 native/PG 실제 reader에서 얻어 page까지 연결한 최소 한 케이스를 포함한다.
PASS: 미로그인/허용외 이메일 → sign-in redirect와 명단/이력 읽기0; 인증 성공 → global latest(팀 다른 행 포함), team query 링크/명단 그대로; empty 문구; Run 저장 카운터 6개 지표와 results.length; pending 완료시간 없음; 날짜·행순서; key 후보6/folder후보4/이슈3·error우선·사내강사 변환 전부 기존 표시와 일치. repo full DTO 비교를 화면 일부 텍스트 assertion으로 대체하지 않는다.
반례: 팀 query로 이력 행을 새로 숨김, 과거 성공 run 표시, 250 경계 결과 누락, 임의 admin 권한 추가, 익명에서 repo 실행, page에서 driver raw오류 출력 중 하나면 FAIL. 합성 URL은 렌더만 하고 클릭/외부 접근 없음.
증거: actual page rendered output/props의 의미 있는 비교, 독립 full DTO 자료, auth/preflight 호출 순서. 무관한 Next 생성 ID만 제외할 경우 제외목록과 이유를 고정한다. 실제 OAuth나 브라우저 운영 검증으로 과대표기 금지.

## V8 — 관련 회귀·증거 정합 (R6,R7 / C7–C9)

PASS: 실행자가 최종 source hashes와 실행 명령/exit/TAP를 연결하고 PG/native/page 필수검사 fail0, 필수skip0, typecheck/lint/build 성공을 확인한다. 기존 lint warning은 목록 대조로 구분한다. 실제 context 의존검색으로 Calendar scope/등록/잠금 등 영향 테스트를 선정하며, 공통 기반 실패나 추가 변경이 있으면 범위를 확장한다.
단일 frozen-source 전체 실행인지 file별 최종 결과 union인지 정확히 표기한다. subset PG/native/page 숫자를 중복 합산하지 않는다. timeout/wrapper 실패는 원본 로그를 보존하며 단순 TAP pass로 wrapper 성공을 주장하지 않는다. timeout 후 자식 observed exit, 후속 worker 중단, 소유 자원 audit 필요가 유지되어야 한다.
증거: immutable runner SHA, 실행 전후 source digests, by-file 결과, 실패→원인→보완→영향 재검증 연결. 실행 도중 source 변경이면 해당 dependency 소비 파일의 최종 결과를 다시 확보한다.

## V9 — 범위·정리·인계 (R7 / C9)

PASS: 제품 reader에서 업무/감사 write0, 의도된 synthetic setup/seed와 분리. 실제 소유 PG 객체/Mongo DB 잔존0·프로세스/port/dbpath 정리 증거, durable logs hashes, execution review와 alignment/handoff가 있다. cleanup 미완료는 PENDING이며 종료 코드만으로 cleanup을 추정하지 않는다.
기능 수락과 원격 통합은 별도 status다. 후속 통합 시 commit/remote evidence 없으면 integration=PENDING. 실제 Drive/Sheets/Notion/CLI writer·등록 Calendar 전체 composition·activity CLI·backup/health·운영복사/복원은 DEFERRED/NOT_RUN을 유지한다. 사용자 구현 지속 승인과 이 하위 사전계획 범위 제한을 혼동해 새 승인 차단을 만들지 않는다.
지금 이 문서의 준비 수락: 외부 세 문서만 쓰고 현재 Calendar/repo 변경0. 미래 구현 수락: 명시 synthetic prepare/seed/정리를 금지하지 않는다. 실제 원천 또는 운영 접근이면 별도 승인·범위 없이는 FAIL.

## 암묵적 가정과 추적

| 가정/위험 | 판정 방법 |
| --- | --- |
| PG 최신은 최신 성공이다 | 거짓: V3 최신 pending/error로 변별 |
| 250이면 동률도 한 유일순서다 | 거짓: V3 경계 허용집합 |
| null 관계는 깨진 관계다 | 거짓: V5 null vs non-null broken |
| PG catch가 명시 Mongo에도 적용된다 | 거짓: V2·V6 실패 경계 |
| 이력 페이지 team query가 접근 필터다 | 거짓: V7 기존 global 의미 보존 |
| read-only면 PII·scope·감사 검증 불필요다 | 거짓: V2·V6·V7 |
| native seed 성공이면 CLI writer 이전 완료다 | 거짓: V9 후속 범위 |
| Calendar key가 context에 있으면 전체 조립 완료다 | 거짓: V2·V8·V9 |
| 기존 closure snapshot은 그대로 새 baseline이다 | 검증 필요: V1 accepted baseline/hash |
| 기존 registry가 모든 민감 필드를 보호한다 | 확인된 범위만: V6, 정책 gap 별도 |

요구사항→기준: R1→V2,V3,V4; R2→V2,V7; R3→V3,V4; R4→V5,V6; R5→V7; R6→V1,V6,V8; R7→V1,V8,V9. 고아 요구사항/고아 기준 0을 독립 메타검토에서 재확인한다.
Verification은 V1–V6,V8의 실제 구현·oracle 증거, Validation은 V7 사용자 시나리오와 V9 범위/인계 의미를 포함한다. 한쪽 PASS로 다른 쪽을 자동 PASS 처리하지 않는다.
다음: 독립 architect의 구조/추적/실패변별/객관성 메타검토 → 필요 보완 → validation-v2/plan-v1-review/plan-v2. 현재 세 문서만으로 구현·제품 최종수락하지 않는다.
