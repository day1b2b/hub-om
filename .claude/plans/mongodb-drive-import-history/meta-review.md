# Independent META / validation review — Drive history read → page

검토 대상: clarify-result.md, plan-v1.md, validation-v1.md. 이 검토는 세 외부 문서를 직접 읽은 독립 계획 검토다. 저장소 원본 코드 재검증, DB, 테스트, 타입검사, 네트워크 접근은 수행하지 않았다. 원본 동작에 관한 판단은 계획에 적힌 계약을 전제로 한다. 수정 산출물은 이 meta-review.md 하나뿐이다.

판정: **REVISE — Level 3와 작은 read→page 범위는 적절하나 v2 수용 조건 보완 필요.** 구조상 Core/Shell/Check 구분과 R1–R7 연결은 성립한다. 제품/실행 검증은 전부 NOT_RUN이며 계획 구조 수락을 테스트 PASS로 바꾸지 않는다. 문서 내 불명확성 판단 신뢰도 높음, 실제 코드 적합성은 이번에 재검증하지 않았으므로 미판정.

Calendar 최종 수락·통합 baseline을 확인한 뒤 Drive 구현을 시작한다. 사용자의 구현 지속 승인은 유지한다. 이 리뷰의 plan-only 범위를 상위 작업 전체의 중단이나 새로운 승인 대기로 바꾸지 않는다.

## 1. 수용을 막는 보완점

### M1 — full DTO oracle 독립성을 실행 가능한 비교 규칙으로 고정 (R1/R6, V1/V4)

근거: plan 60–65행, validation 16–19·37–39행. 독립 literal과 세 worker의 취지는 좋다. 다만 “네 interface 전체” 선언만으로는 누락 필드나 원본/current의 같은 오류를 잡았는지 알 수 없다.

v2 수용 조건:
- 두 export에 대해 반환 객체와 각 nested row/candidate의 실제 own-key 목록, 값/타입/null/빈 문자열/날짜/배열 순서를 동결 원본에서 추적 가능한 표로 기록한다. 현재 구현의 DTO를 복사해서 expected를 만들지 않는다.
- original PG → 독립 literal/허용집합, current PG → 같은 literal/집합, native Mongo → 같은 literal/집합을 각각 판정한다. original=current만으로 수락하지 않는다.
- 동일 fixture의 의미 데이터는 공유 가능하되 original runtime이 current codec/DTO builder/presenter/selector를 import하지 않아야 한다. backend별 seed 변환을 공유할 때도 실제 저장 행을 독립적으로 확인하여 seed가 잘못된 의미를 양쪽에 주입하는 문제를 잡는다. 기존 registry/codec 재사용 자체를 금지하는 것은 아니다.
- loader/current-import negative control 외에 comparator의 작은 변형 반례를 둔다: 필드 하나 삭제/추가, null↔빈 문자열, 배열 순서 변경, count 변경, 서로 다른 후보의 필드 혼합이 각각 실패해야 한다. 전체 mutation-testing 프레임워크는 불필요하다.
- synthetic 고유 표시값과 결과 행의 대응을 명시하고, 실제로 동일 DTO인 중복 행은 set 변환으로 지우지 않는다. 배열은 multiplicity를 보존한다.

### M2 — 동률·collation·특수 take를 서로 분리하여 닫기 (R1/R3, V3)

근거: plan 24–27행, validation 30–33행. 현재 허용집합 설계는 타당하나 양수 250 경계만으로 음수 take와 collation 동등성을 수락할 수 없다.

v2 수용 조건:
- 단건 두 sort key, run.startedAt, 결과 세 sort key마다 우선순위를 독립 반례로 검증한다. 하위 키가 더 유리해도 상위 키가 불리한 행은 앞설 수 없다.
- 249+경계 동률3 fixture는 전체 배열 길이250, 상위249의 각 행 정확히1회, 경계3 중 정확히1개, 나머지0 및 full DTO를 함께 비교한다. 동률이 아닌 구간의 순서를 느슨하게 만들지 않는다. tied run이면 run 메타데이터와 results가 반드시 같은 run의 완전한 DTO여야 한다.
- effective PG collation은 이름뿐 아니라 provider/locale/version 및 DB/column 적용 차이를 확인해 기록한다. 문자열이 달라도 collation상 같은 경우의 동률 처리를 명시한다. 샘플 몇 개 일치만으로 임의 Unicode 전체 동등성을 주장하지 않는다. 새 ICU/정렬 의존성 또는 근거 없는 localeCompare로 범위를 확장하지 않는다. 지원 baseline을 재현할 근거가 없으면 V3 PENDING으로 남긴다.
- 생략/0/양수/음수/잘못된 수 인자의 original PG 관찰표를 먼저 확정한다. 음수 take의 방향·반환 순서·동률 절단도 별도 판정한다. 251을 250으로 clamp하지 않는다.
- NaN/Infinity/undefined는 JSON 직렬화 중 null/누락으로 바뀔 수 있다. worker 입력을 태그로 전달하고 함수 호출 직전 실제 JS 값으로 복원한다. 음수와 malformed 인자는 정상 저장 상태에서 원본 계약을 먼저 확인한다. 손상 저장 상태와 결합했을 때 인자 처리/저장소 실패 우선순위도 명시해 구현마다 결과가 달라지지 않게 한다.

### M3 — 고려 후보·부모·키의 정확한 경계 (R2/R4, V2/V5/V6)

근거: plan 35–39·43행, validation 43–46·50행. 필수 run/nullable session 구분은 좋지만 “고려 대상”이 take 이전인지 이후인지, session의 어느 필드를 확인하는지 명확하지 않다.

v2 수용 조건:
- 단건은 exact operationId의 후보 집합, run 조회는 선택된 run의 결과 집합으로 한정한다. 계획의 의도가 take 전 전체 고려 후보 검사라면 이를 명시하고, 출력250 밖의 orphan/session 손상이 실패하는 케이스와 무관한 run의 손상이 조회를 막지 않는 케이스를 각각 둔다. 최신 run0/null의 의미를 전역 무결성 감사로 확대하지 않는다.
- nullable session은 정상, non-null 참조는 같은 namespace/snapshot의 정확한 session ID 존재 여부로 판정한다. soft-delete 허용. 현재 Company/Course 이름이나 현재 session.operationId와 과거 snapshot.operationId의 일치를 새 업무 불변식으로 강제하지 않는다. 필요하면 원본 계약 증거로만 추가한다.
- 같은 ID를 가진 부모가 다른 namespace에만 있어도 참조 성공으로 처리하지 않는다. 두 namespace에 동일 run/result/session ID와 다른 고유 값이 있을 때 full DTO가 섞이지 않는 native 케이스를 둔다.
- 저장소 metadata/validator가 이미 보장하는 _id/id 일치·ID 타입·필수 관계 키를 재사용한다. 해당 불변식은 준비 단계의 validator 거부 또는 명시 corruption-read 실패 중 어디서 증명하는지 구분한다. 깨진 키를 임의 정규화하거나 무관한 저장 상태까지 감사하지 않는다.
- 암호화 키 검증은 올바른 keyring/active-key 성공, 필요한 key 누락·다른 키·손상 tag/cipher 실패, metadata/policy 불일치 실패를 분리한다. 기존 codec의 지원 범위 안에서만 검사하고 신규 rotation 정책은 만들지 않는다.

### M4 — snapshot 검증과 write0 증거의 모순 제거 (R4/R7, V5/V6/V9)

근거: validation 45행은 다른 native session의 쓰기를 요구하지만 46행은 조회 전후 raw 동일을 요구한다. 같은 collection 전체를 비교하면 정상 interleaving도 실패하거나 test writer의 변경을 과도하게 제외하게 된다.

v2 수용 조건:
- 정적 fixture에서 read 전후 업무 컬렉션·ActivityChange의 정렬된 전체 문서 또는 canonical digest를 비교한다. count/총 bytes만 같다는 이유로 값 변경을 놓치지 않는다. setup/index/metadata/seed는 측정 전에 끝낸다.
- interleaving fixture는 별도 세션의 의도한 변경을 정확히 열거하고, reader가 발생시킨 쓰기0과 controller의 쓰기를 구분한다. 실제 read가 첫 snapshot을 확보한 뒤 writer가 commit하도록 barrier를 배치한다. 단순 두 Promise 동시 시작은 snapshot 증거가 아니다.
- 반환 가능한 전/후 full DTO 집합과 불가능한 혼합 tuple을 명시한다. 고정 snapshot이 이미 시작된 barrier라면 그 시점에 맞는 결과를 기대한다. 다른 시점의 결과를 무조건 모두 허용하지 않는다.
- 세션/트랜잭션의 내부 bookkeeping까지 제품의 업무 쓰기로 간주하지 않는다. 읽기 중 감사 INSERT, 복구 UPDATE, 자동 prepare/index는 허용하지 않는다.

### M5 — 실제 페이지 연결을 PG/native 양쪽으로 명확화 (R1/R2/R5/R6, V7)

근거: validation 58행 “native/PG 실제 reader … 최소 한 케이스”는 둘 중 하나만 연결해도 충족한다고 읽힐 수 있다.

v2 수용 조건:
- frozen original PG page, current default PG page, current explicit native page를 동일한 의미 fixture로 각각 최소1회 연결한다. page와 presenter, 저장소 reader는 실제 코드다. auth platform 입력/Next redirect·Link 등 표시된 harness 경계만 대체한다.
- 저장소의 전체 DTO 비교와 렌더된 행 전체의 순서·셀·href/query/요약 값 비교는 별도 증거다. 페이지에 원래 없는 DTO 필드까지 UI 표시를 추가하지 않는다.
- 후보 제한은 7개→6개, folder5개→4개, issue4개→3개의 마지막 포함/첫 제외를 확인한다. key와 folder가 동시에 있으면 기존 key 우선, error와 issue가 동시에 있으면 기존 error 우선을 확인한다. 250 경계에서는 row 수와 전체 row identity를 비교한다.
- 미로그인/허용외 이메일의 실제 guard 분기와 redirect, auth 후 drive-only/team-only 빈 scope의 양쪽 데이터 읽기0을 단계 카운터로 검증한다. auth 함수 전체를 “통과” stub으로 만든 테스트만으로 인증 기준을 수락하지 않는다.
- protected summary/notes처럼 DTO에 없는 저장 필드는 “DTO에 승인된 값이 있어야”라는 V6 문장 대상에서 제외한다. 원래 DTO 필드만 표시하고, 나머지는 암호화 저장·비노출을 검증한다. 허용된 저장 result.error는 보존하며 runtime error canary만 별도로 차단한다.

## 2. 60초/누적 예산: 비용 대비 권고 (M6, R4/R7, C5/V6)

대안 A: scan별 기존 한계만 유지. 비용이 가장 작고 공통 코드 영향도 적지만 여러 scan/부모 확인/transaction retry를 합친 총 작업량은 제한하지 못한다. N+1 조회를 허용하면 bounded read vertical이라는 목표가 약해진다.

대안 B: 이 reader 호출에만 적용하는 작은 누적 예산과 deadline. 총 작업을 제한하는 이점이 있고 현재 두 메서드에 한정할 수 있다. 다만 부모 읽기와 retry를 포함하면 20,000개의 결과를 정상으로 기대할 수 없으며 실제 cancellation/cleanup 검증 비용이 생긴다.

권고: **B를 로컬·최소 구현으로 채택하되 아래 계측 계약을 v2에서 먼저 확정.** 공통 Mongo store에 범용 deadline/쿼터 프레임워크를 만들거나 Calendar runtime/lease를 바꾸는 것은 이 작업의 비용 대비 이익을 넘는다. 로컬로 구현 불가능하다면 그 근거와 대체 bounded-query 계획을 상위에 제시하고 C5/V6를 명시적으로 재계획한다. 예산 기준을 조용히 삭제한 채 PASS로 만들지 않는다.

수용 조건:
1. budget 소유자는 명시 Mongo public read 호출1회다. 기본 PG 의미·auth/teamMembers 조회에 새60초 정책을 끼우지 않는다. 여러 cursor/session과 transaction retry는 같은 deadline/budget을 공유한다.
2. 시간은 monotonic 기준 호출 진입부터 마지막 DTO 반환 전까지 측정한다. 각 driver 대기는 남은 전체시간과 기존 scan15초의 작은 값으로 제한한다. decode/sort/관계 처리 후에도 만료를 확인한다. Promise.race로 오류만 반환하고 실제 작업을 남겨두는 방식은 수락하지 않는다. cleanup 완료에 별도 유한 시간이 필요하면 “60초 처리 deadline”과 “cleanup까지의 실제 elapsed”를 구분한다. 정확60초의 포함/만료 규칙도 한 가지로 고정한다.
3. rows/bytes는 애플리케이션이 실제 받아 처리하는 raw BSON 문서의 누적량으로 정의하고, metadata/부모/재조회·재시도/초과 감지용 한 행을 어떻게 계상하는지 명시한다. output DTO bytes나 서버 index entries 수와 혼동하지 않는다. 데이터 문서와 고정 크기 metadata를 별도 제한한다면 예외를 문서화한다.
4. 누적20,000행/32MiB는 결과 행 한도와 다르다. 예: result19,999+run1이면20,000이나 추가 session1이면 초과할 수 있다. 이 축소는 명시 Mongo의 의도적 차이이며 문서·fixture가 같은 계상식을 사용해야 한다. 250 출력 limit의 원본 계약과 혼동하지 않는다.
5. 부모 확인은 unique ID의 bounded batch로 하고 결과마다 독립scan을 반복하지 않는다. 대형 run/result 전수 materialization도 한계를 넘기면 고정 실패하며 truncate250으로 숨기지 않는다. 일반 쿼리 최적화/새 writer로 확대하지 않는다.
6. 실제 native BSON 경계 테스트를 한 세트로 통합 재사용한다: 정확행/초과행, 정확byte/+1byte, scan별로는 통과하지만 누적으로 초과, session 읽기를 포함한 초과, retry 시 초기화 없음. byte 정의에 맞는 합성 작은 문서 여러 개를 사용하고 DB 단일 문서 제한에 걸린 것을32MiB 누적 성공/실패로 오인하지 않는다.
7. 60초 시간 경계 대부분은 명시 clock 주입 테스트로 빠르게 검증하고, 실제 native pending cursor 취소/세션 종료 한 경로를 별도로 검증한다. test 전체를 여러 차례60초 대기시키는 것은 비용 대비 이익이 낮다. 주입 테스트를 실제 wall-clock60초 증거로 표기하지 않는다. cancellation API/remaining deadline 전달은 실제 경로에서 관찰한다.

## 3. 요구사항 추적과 최종 gate

| 요구사항 | 기존 기준 | 보완 후 수용 조건 |
| --- | --- | --- |
| R1 원본 API/DTO/PG | V2,V3,V4 | M1/M2/M5: 두 export, 세 backend/original 비교, 전체 키·값·실패 의미 |
| R2 scope/auth/composition | V2,V7 | M3/M5: 부분scope 양쪽읽기0, namespace 분리, Calendar 등록 불변식 회귀 |
| R3 정렬/take | V3,V4 | M2: 완전 후보·경계 membership/multiplicity, 실제PG 인자/locale 자료 |
| R4 부모/PII/실패 | V5,V6 | M3/M4/M6: 고려집합 확정, 관계키/암호키 구분, snapshot·예산·raw오류 |
| R5 사용자 페이지 | V7 | M5: PG/native 각각 실제page, 전체행·링크·표시 제한과 인증 |
| R6 독립 증거 | V1,V6,V8 | M1/M2/M5: frozen closure와 independent literal/negative controls, 실제PG/native 증거 |
| R7 쓰기0/제한/인계 | V1,V8,V9 | M4/M6: read delta의 정확한 정의, 별도setup/정리, Calendar 후 통합순서 |

R1–R7 또는 V1–V9에 고아 항목은 보이지 않는다. 단, clarification의 “Level3 R1…R6 점수”와 기능 요구사항 R1…R7은 다른 척도이므로 rigor 점수 항목을 L1…L6 등으로 구별하면 인계 혼동을 줄일 수 있다. 이 명명 정리는 제품 요구사항 추가가 아니다.

v2 계획 수용은 M1–M6의 판정 규칙과 케이스·증거 소유자가 문서에 구체화되면 가능하다. 그 시점에도 PG/native/page 실행은 NOT_RUN이다. 구현 수용은 필수 케이스의 실제 exit/최종source hash/원본closure/전체DTO/페이지 출력/자원 정리가 연결된 뒤에만 가능하다. 이미 정의된 전체 Level3 문서 외 새 범용 테스트 시스템이나 추가 승인 절차를 요구하지 않는다.

범위 유지: 두 조회→기존 페이지, 기본 PG 보존, 명시 native read 및 저장용 명단 composition. writer/Drive 원천/OAuth/CLI guard 제거/schema·privacy registry 변경/전역 app selector/Calendar bundle 확장은 제외한다. Calendar 통합 여부, 기능 검증, 전체 Mongo 운영 이전 상태는 각각 기록한다. 상위의 계속 구현 승인은 유효하며 기술 검증으로 닫을 문제는 사용자 재승인을 요구하지 않는다.
