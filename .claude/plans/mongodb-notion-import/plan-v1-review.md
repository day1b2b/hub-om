# Plan v1 독립 검토

**validation-v2의 M1/M2 반영은 수락합니다. 전체 검증안 재작성은 불필요합니다.** v1 대비 제목·상태 외 실질 변경은 요청한 두 항목뿐입니다. plan-v1은 구조 PASS이며, 아래 최소 문구 보완으로 v2와 정합성을 맞추면 됩니다. 실행 수락은 아닙니다.

### Phase A — 구조 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| S1 태그 | PASS | 계획 단계에 Shell/Core/Check가 명시되어 있음 |
| S2 Core 존재 | PASS | 계획 S2의 선택·평가 순서와 S3의 변환·저장 의미가 구체적 Core임 |
| S3 조건부 규칙 | PASS | auth/token/JSON/URL/scope/원천/저장/감사의 선후관계와 의도적 변경을 구분함 |

M1은 구조 FAIL뿐 아니라 **미확정도 구현·검증 실행·수락 중단** 대상으로 명시합니다. M2는 저장 전 실패·confirmed abort와 commit 이후 오류를 구분하고, 미확정 commit을 V5로 연결합니다. V5의 실패표와 충돌하지 않습니다.

### Phase B — 결정성·실패 변별·추적성

검증 기준은 다음 반례를 실제로 구별할 수 있게 작성되어 있습니다.

| 반례 | 구별해야 하는 결과 |
|---|---|
| TOKEN이 `""`, API_KEY는 유효 | fallback 없이 설정 오류. JSON/source 호출0 |
| 잘못된 ID + 완전한 scope / 누락 port | 전자는 reader ID 오류, 후자는 preflight generic400·source0 |
| 앞 page의 malformed property + 뒤 page HTTP 실패 | 모든 page를 먼저 읽으므로 뒤 page HTTP 실패가 먼저 드러남 |
| 유효한 course alias + title 탐색에서 깨지는 property | title 탐색을 생략하는 최적화가 원본 실패 의미를 바꾸면 검출 |
| 실제 commit 완료 후 최종 오류 | generic400·전체 저장 유지·audit400. raw 불변을 요구하면 오판 |
| callback retry + 여러 page | reader1·fetch는 정상 page 수. fetch1을 요구하거나 원천을 다시 읽으면 오류 |
| A/B 동시 요청 | 서버 token 하나를 유지하면서 source/DB/namespace 격리 검증 |

독립 frozen closure, 독립 literal, 변조·import 탈출 음성대조를 함께 요구하므로 단순한 세 backend 간 일치만으로 공통 오류를 통과시키지 않습니다. 승인된 DTO·암호화 저장과 오류/로그 노출도 분리되어 있어 새 개인정보 정책을 추가하지 않습니다.

### Phase C — V1–V6 대조

| 기준 | 계획 대응 | 판정 및 남길 증거 |
|---|---|---|
| V1 원본 독립성 | S1/S4/S5 | 적합. closure·loader manifest와 음성대조 실행 필요 |
| V2 선택·auth·preflight | S2 | 적합. 공용 credential 문구만 아래처럼 명확화 |
| V3 실제 reader 의미 | S3 | 적합. pagination→mapping 순서와 eager title 반례를 유지 |
| V4 전체 결과·격리 | S3/S4 | 적합. full tuple, 두 rowCount, 199/201, 중복 두 일정, 비대상 raw 상태를 축약하면 안 됨 |
| V5 실패·재시도·비노출 | S2/S3/S4 | 적합. commit 상태별 결과를 계획에도 명시 |
| V6 최종 증거·정리 | S5/S6 | 적합. 재사용·신규 실행·미실행 및 통합 상태를 구분 |

**누락된 요구사항은 발견하지 못했습니다.** 아래는 검증 확대가 아닌 계획의 모호한 표현 교정입니다.

### 최소 plan-v2 수정 문구

**1. 상태 문단에 M1 및 검증 기준 연결 추가**

> 구조 gate S1–S3 중 FAIL 또는 미확정이 있으면 후속 구현·검증 실행·수락을 중단한다. 계획 보완과 구조 재검토 PASS 후 재개한다. 결과 수락은 validation-v2의 V1–V6 필수 하위 항목을 모두 충족해야 하며, 미실행은 PENDING으로 기록한다.

**2. S2의 “scope A/B의 source/token/namespace를 혼합하지 않는다” 교체**

> credential 선택은 기존 route의 서버 공용 `NOTION_TOKEN ?? NOTION_API_KEY`로 유지한다. 같은 process의 A/B 동시 검사는 불변 합성 서버 token 하나를 사용하고 source/database/namespace만 분리한다. 환경 선택 행렬은 직렬 또는 별도 worker에서 실행하며 동시 env 변경을 하지 않는다. token의 정확한 전달과 오류응답·로그·감사 비노출을 검증하되 scope별 서로 다른 token 지원을 주장하지 않는다.

**3. S3 reader 문단에 반례 한 문장 추가**

> 모든 page 읽기 후 mapping하는 실패 우선순위와, 유효한 course alias가 있어도 수행되는 title 탐색의 실패를 V3의 교차실패 fixture로 고정한다.

**4. S3 transaction 문단의 첫 두 문장 교체**

> 저장 전 실패와 confirmed abort는 run/source records 전체 raw 불변을 요구한다. 실제 commit 후 ACK 회복은 200·전체 저장 유지·callback 재실행0, 실제 commit 후 최종 오류는 generic400·전체 저장 유지·audit400으로 판정한다. 미확정 commit은 V5의 주입·관찰 기준에 따라 전체 반영 또는 미반영을 구분하며 부분 저장을 허용하지 않는다. 원천 reader·parser·각 명단 조회는 transaction callback 밖에서 한 번 수행하고, fetch 횟수는 정상 pagination page 수로 판정한다. 재시도로 원천 재조회나 추가 run을 만들지 않는다.

이후의 두 중복 일정·새 unique 금지·동일 fixture 전체 tuple 비교 문장은 유지합니다.

**5. S4의 인접 회귀 문장 구체화**

> 기존 증거 재사용 조건이 충족되고 Calendar runtime 의존성이 변경되지 않으면 Calendar는 기존 scope 일반 회귀 3개를 실행하며 전체 24개 반복을 요구하지 않는다. 재사용 기준 SHA·의존 파일/테스트/로그 hash·정확한 case와 한계를 기록한다. 공통 context 변경의 영향 또는 회귀 실패가 확인되면 해당 영향 범위 검사를 확대한다. Notion의 실제 raw HTTP/property/parser/full tuple/auth/env/error 연결은 새로 검증한다.

Calendar **3개/24개 판단은 reconnaissance에 기록된 Carver 조사에 근거**합니다. 이번 검토에서 해당 재사용 hash나 실행 결과를 독립 재검증한 것은 아닙니다.

검토 결과는 **validation-v2 수락, plan-v1 구조 PASS 및 위 문구 보완 권고**입니다. 파일 수정·DB 접근·테스트 실행은 하지 않았으며 V1–V6 실행 상태는 모두 **NOT_RUN/PENDING**입니다.

## Plan v2 최종 확인

Parfit이 v1→v2의5보완 및S6문구를대조하여추가모순/범위확대/차단gap0으로최종수락했다. 계획기준구현착수가능이며제품/DB/검증PASS아니다.
