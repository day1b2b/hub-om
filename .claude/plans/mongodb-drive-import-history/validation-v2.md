# Validation v2 — Drive history read → page

입력: [clarify](clarify-result.md), [plan](plan-v2.md). 현재 사전계획 위임 산출물이며 상위 구현 지속 승인은 유지된다. 이 문서는 같은 세션이 작성한 v2 검증 기준이다. Sagan meta-review M1–M6와 조정자 전달 Parfit critic을 반영하여 READY_FOR_COORDINATOR_REVIEW 상태다. 계획 최종수락을 의미하지 않는다. 독립 critic/architect 검토 및 실제 테스트를 수행했다고 주장하지 않는다.

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
snapshot: 실제 native 두 session의 제어된 interleaving으로 run 시간/결과 변경 전후를 만든다. 첫 snapshot 읽기 뒤 controller commit, 이후 reader 재개 barrier를 기록하며 해당 호출은 변경 전의 완전 DTO, 다음 새 호출은 변경 후 완전 DTO여야 한다. 존재하지 않았던 run/result 혼합 tuple은 FAIL. PG의 불가능한 FK 상태는 Mongo fault-injection 증거로 표시하며 실제 PG에서 재현했다고 주장하지 않는다.
증거: actual native repository 결과, interleaving barrier 기록, 정적 fixture에서는 조회 전후 canonical 전체 raw 문서 digest 동일. 경쟁 fixture는 controller의 정확 변경과 reader business/audit write0을 분리한다. 관계 검사 stub만으로 PASS 금지.

## V6 — PII·raw 오류·resource boundary (R4,R6,R7 / C1,C5)

실제 codec 보호 필드마다 synthetic marker를 seed한다. raw encrypted storage에는 보호 필드 marker 평문 0, 원래 반환되는 보호 필드만 DTO에 원본과 같은 승인된 값이 있어야 한다. summary/notes/folderId 등 비반환 보호 필드는 정상 인증·암호화 저장·DTO 키 부재를 검사한다. session private payload는 existence-only projection으로 읽지 않는다. codec/HMAC companion/metadata/key material은 DTO/진단에 0. 잘못된 key/cipher/tag/필수 companion/policy, driver Error 및 MongoServerError에 canary URI/개인값을 넣어 고정 오류 외 노출 0을 확인한다. error injection은 실제 driver 장애와 별도 라벨이다.
기존 registry에 없는 snapshot 회사/과정 이름은 암호화되었다고 주장하지 않는다. 현재 policy 변경 없음 및 전체 PII 전환 gap을 기록한다. 저장 result.error 표시와 새 runtime raw-error 누출은 따로 검사한다.
자원: scan 및 호출 누적 한계 각각 정확 경계/초과를 테스트한다(20,000행,32MiB,scan15초/호출60초). 실제 BSON bytes를 계산해 byte 경계를 만든다. 시간 주입 검사는 주입이라고 라벨링하고 native 성공/실패 증거와 구분한다. 초과 시 null/잘린250행이 아닌 고정 실패, 종료 뒤 열린 cursor/session 0. deadline 재시작 금지.
증거: codec raw 검사, 실제 native read, sanitizer exact allowlist 테스트, elapsed/deadline 실패, read 전후 문서·감사 write delta=0. 명시 synthetic prepare/index/metadata/test seed/cleanup은 이 runtime write delta에서 분리해 허용한다.

## V7 — 실제 페이지 사용자 의미 (R2,R5 / C6)

사용자 시나리오: 인증된 운영자가 가장 최근 저장 run의 후보·이슈를 기존 화면에서 보고 운영 링크를 연다. 원천을 다시 조회하거나 운영값을 수정하지 않는다.
실제 `drive-import-runs/page.tsx`를 호출/렌더한다. auth platform 입력·Next redirect/Link 등 필요한 harness 경계만 교체하며 page나 presenter 자체를 fake 구현하지 않는다. original 페이지도 frozen closure에서 비교한다. 저장소 full DTO는 frozen original PG reader→원본 page, current default PG reader→current page, current explicit native reader→current page를 각각 최소 한 케이스 연결한다. 셋 중 하나만 실행해서는 통과하지 않는다.
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
다음: 조정자가 v2 본문과 아래 보완 계약을 검토하고 실제 PG 선행 oracle/구현 순서를 관리한다. 독립 v2 재수락은 아직 없다. 현재 세 문서만으로 구현·제품 최종수락하지 않는다.


## v1→v2 보완과 필수 판정 세부 (M1–M6 / Parfit)

기존 V1–V9의 AND 조건에 아래 항목을 추가한다. 서로 충돌하는 해석은 허용하지 않는다. 실행 순서는 plan-v2의 Parfit 최종 실행 순서1–6이다. 문서에서 READY는 조정자 검토 가능만 뜻하며 제품 verification/validation은 전부 NOT_RUN이다.

### V1/V4 — exact 키·타입·중복과 negative controls (M1)

Plan M1의 단건/Run/RunResult own-key 목록이 각각 정확히 같아야 한다. 후보는 static TS 선택 필드 whitelist가 아니라 fixture object의 실제 own-key 전체를 보존한다. nullable 문자열과 날짜, 후보/이슈 nested 값의 타입·빈 문자열·배열 순서도 동일해야 한다. extra field도 FAIL이다.
original PG/current PG/native 각자를 independent literal/동률집합에 판정한다. backend끼리 같은 오답은 FAIL. seed 재사용 시 backend 저장 행도 fixture 의미와 별도 비교하고 current DTO builder를 expected로 사용하지 않는다.
comparator 단위 반례: field 삭제/추가, null↔빈 문자열, non-tie 행순서 역전, count+1, 서로 다른 row의 필드 혼합 각각 FAIL. 동일 DTO 두 행은 길이2로 남아야 하며 set dedup으로 길이1이면 FAIL. property 삽입순만 다른 object는 PASS.
담당 증거: PG oracle 담당의 literal/키 표, native 담당의 저장 행·DTO, 작은 comparator controls. mutation framework는 만들지 않는다.

### V2/V3 — 정확 순서와 PG actual 선행 gate (M2/Parfit P1)

제품 구현 전 frozen actual PG에서 생략/0/양수/음수/잘못된 수 관찰표와 effective collation 자료를 확보한다. 현재는 그 실행을 하지 않는다. gate 미확보이면 구현 착수 준비 미완료이며 새 업무 결정을 사용자에게 요구할 이유는 아니다.
명시 scope 선택→인자 판정→read readiness/snapshot→고려 후보와 부모/codec 검사→sort/take→DTO→deadline 순서다. 누락scope+잘못된 인자는 scope 실패/읽기0. 올바른 scope+원본 거부 인자는 null/DB·metadata읽기0. 정상 인자는 저장소 손상을 숨기지 않는다.
NaN/Infinity/undefined는 IPC 태그로 전달하고 실제 호출 직전 JS 값으로 복원했음을 typeof/Object.is로 확인한다. 특수 인자를 JSON에서 null로 바꾼 테스트는 FAIL.
단건(run.startedAt,createdAt), run(startedAt), 결과(candidateCount,companyName,courseName)의 각 우선순위에 하위키 유리·상위키 불리 반례를 둔다. 음수 take는 selected identity+중복수+order+동률절단을 각각 frozen PG actual literal로 확인한다. native comparator 공유 금지.
collation은 DB/각 정렬 column override, provider/locale/version을 기록하고 시험을 위해 baseline PG collation을 바꾸지 않는다. 서로 다른 문자열이 collation상 같은 경우에만 해당 키 동률로 다룬다. 실제비동률 full DTO/순서를 느슨하게 만들지 않는다. 샘플 성공만으로 임의 Unicode 동등을 주장하면 FAIL, 재현 근거가 없으면 V3 PENDING.
249+동률3 경계: 길이250, 상위249 각1회, 동률3 중1개 정확1회, 나머지0. full DTO와 non-tie 순서 모두 검사한다. tied run은 그 run의 메타데이터+그 run 결과만 허용한다.

### V5/V6 — 고려 집합·부모 projection·key 성공/실패 (M3/Parfit)

단건 exact operationId의 Result 전부, run 조회는 선택 run의 Result 전부를 take 전에 검사한다. 아래 판정표를 native actual 케이스로 증명한다.

| 입력 | 기대 |
| --- | --- |
| actual PG에서 유효한 take0 + 고려 후보 broken run/session/cipher | 명시 고정 실패, output0이 검사를 우회하지 않음 |
| take250 + 출력 밖251번째 broken session/cipher | 고정 실패 |
| 유효 음수 take + 미선택 후보 broken session/cipher | 고정 실패 |
| 다른 run/다른 operationId의 무관한 Result payload 손상 | 대상 full DTO 성공 |
| session=null | 성공 |
| session 존재+soft-deleted 또는 snapshot과 operationId 다름 | 성공, equality 강제 금지 |
| session id/_id 정상, unrelated private payload 손상 | 성공: identity projection만 읽음 |
| non-null session이 같은 namespace에 없음 | 고정 실패 |
| run/session이 다른 namespace에만 같은 ID로 존재 | 고정 실패 |
| 두 namespace의 동일 run/result/session ID, 다른 synthetic marker | 각 full DTO가 자기 namespace literal과 일치, 혼합0 |
| run0 | run 조회 null, 전역 orphan 감사 아님 |

take0/출력 밖/음수 미선택 손상 실패는 원본 PG와 의도적 차이다. 원본 actual 결과는 별도 기록하며 PG 동등성 PASS로 합치지 않는다. 정상 비손상 입력의 전체 DTO/keys/순서는 그대로 필수다.
Run selector는 public id/startedAt projection, selected/단건 관련 Run은 full decode. 미선택 Run private payload 손상은 무관하나 selection 키 손상은 실패. OperationSession은 같은 snapshot/namespace의 정확 id 존재만 `_id/id` projection으로 확인하며 current company/course/session.operationId를 업무 불변식으로 추가하지 않는다.
_id/id 불일치·타입·필수관계키는 validator 거부인지 corruption-read 거부인지 케이스별 표시한다. 실제 codec 불변식보다 임의 완화/정규화 금지. keyring+active-key 정상 성공, 필요한 key 누락, 다른 키, tag/cipher 손상, policy/metadata mismatch는 각각 증거를 낸다.
returned protected fields는 원래 DTO 값과 대조한다. authenticatedNotReturned(summary/notes/folderId)는 정상 decode 성공과 손상 실패, raw 암호화와 DTO key 부재를 검증한다. session private fields는 이 인증 범위에서 제외한다. 이 세 범주를 하나의 '모든 보호필드 DTO 포함' 검사로 합치면 FAIL.

### V5/V9 — write0 및 실제 snapshot (M4)

정적 case에서 setup/seed/index 준비를 마친 뒤 전체 정렬 canonical 문서 digest before=after를 검사한다. 문서수/bytes 동일만으로 PASS 금지. business collection/ActivityChange에서 reader 쓰기0을 별도 확인한다.
경쟁 case는 reader snapshot 확보 이후 controller의 정확한 쓰기를 commit시키는 barrier를 사용한다. 반환은 변경 전 literal full DTO, 다음 새 read는 변경 후 literal. command 관찰로 controller 변경과 reader 쓰기0을 분리한다. 전후 collection digest 동일을 이 경합 case에 요구하지 않는다. 내부 transaction bookkeeping은 업무 쓰기 아님; repair/update/audit/index 자동 생성은 FAIL.

### V6 — 로컬 budget 계상·시간 의도차이 (M6/Parfit)

행=호출이 실제 받은 raw BSON 문서 누적; byte=그 문서 각각 BSON.calculateObjectSize 누적. public projection/full 재조회가 같은 문서라도 두 번 수신하면 두 번 계상한다. Run selection, selected Run 재조회, Results, Session identity, 호출 중 metadata, retry 재수신, 초과 탐지 한 행 모두 포함한다. index entries/DTO bytes는 제외. 사전 open metadata를 캐시로 재사용하면 호출 수신0이며 이 조건을 명시한다.
경계 fixture는 모든 실제 수신 합계가 정확20,000/32MiB가 되도록 독립 계산한다. result20,000+부모를 성공 fixture로 쓰면 FAIL. +1문서/+1byte는 실패. scan별 통과/누적초과, parent포함초과, 같은Doc 재수신/retry 초기화 없음도 검사한다. 하나의 재사용 fixture군으로 충분하며 단일16MiB BSON 실패를32MiB 누적 검사로 주장하지 않는다.
명시 read 함수 진입부터 monotonic elapsed<60,000ms에서만 반환 가능, >=60,000ms 실패. PG/auth/teamMembers에 이 정책을 추가하지 않는다. 59,999/60,000/60,001 clock주입과 remaining-time 전달/반환전 검사 케이스를 검증한다. 이는 실제 wallclock60초 실행증거가 아니다. scan15초와 전체 remaining 중 작은 값 적용, decode/sort/부모 이후도 만료 확인. 실제 native pending read 취소·cursor/session 종료 한 경로는 별도 actual 증거다.
반환 뒤 작업을 남기는 Promise.race는 FAIL. 처리deadline과 cleanup elapsed를 구분하고 cleanup 미종료를 성공으로 보고하지 않는다. 구현이 공통 store quota/Calendar lease 변경을 요구하면 범위 재계획; reader-local 해결 없이 임의 framework 확장 금지. 60초/누적예산은 PG와 의도적 차이이며 unbounded PG-equivalence로 표현하면 FAIL.

### V7 — 세 실제 page 연결·legacy render 반례 (M5/Parfit)

originalPG/currentPG/currentNative 각각 실제 reader→실제 page 최소1회. auth 플랫폼 입력/Next 경계만 대체하고 실제 workspace guard 분기·redirect를 실행한다. full DTO 비교와 전체 rendered rows/cells/hrefs/query/metrics 비교는 별도 증거다.
후보7→6, folder5→4, issues4→3에서 마지막 포함/첫 제외를 확인한다. key+folder는 key우선, error+issues는 error우선. 250행 수와 전체 identity 비교를 유지한다. 인증 실패 및 auth후 drive-only/team-only/empty scope에서 양쪽 데이터 읽기0을 단계 counter로 확인한다.
reader는 legacy truthy object candidate를 보존한다. candidate.value가 object여서 원본 페이지 렌더가 throw하는 fixture는 original/current 양쪽 동일 실패를 기대한다. reader DTO 성공과 page 렌더 실패를 따로 기록하고 새로운 cleanse/stringify/skip 정책을 추가하지 않는다. 모든 후보 렌더 성공을 수락 조건으로 만들지 않는다. 정상 candidate fixture의 full UI 비교는 줄이지 않는다.

## 반영 추적·현재 상태

| 입력 지적 | v2 계약 | 증거 소유자 | 현재 |
| --- | --- | --- | --- |
| Sagan M1 | own-key/full literal/multiplicity/negative controls | PG+native | 설계 반영, 실행 NOT_RUN |
| Sagan M2 / Parfit take·collation | 실제 PG 선행 gate, tagged args, sort priority/negative selection | PG oracle | NOT_RUN |
| Sagan M3 / Parfit 부모·keys | take 전 집합, identity-only session, crossnamespace/keyring | native | NOT_RUN |
| Sagan M4 | static digest vs controller interleaving 분리 | native | NOT_RUN |
| Sagan M5 / Parfit 비반환PII·candidate | 세 actualpage 연결, returned/nonreturned/projection 분리 | page+native | NOT_RUN |
| Sagan M6 / Parfit budget | reader-local raw누적/같은Doc/정확total/60초 차이 | 제품+native | NOT_RUN |

Parfit 원문 파일은 없으며 조정자 전달 P1/P2를 입력 근거로 기록했다. v1/clarify/meta 파일을 수정하지 않았다. 독립 검토자에게 v2 PASS를 받은 것으로 표시하지 않는다. 조정자 읽기 검토 준비 완료, 구현은 Calendar 선행 수락과 PG actual 기술 oracle gate 뒤 기존 승인 범위에서 진행한다.
