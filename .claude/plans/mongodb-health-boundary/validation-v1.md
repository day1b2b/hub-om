**연결 확인 범위의 계획 방향은 타당합니다.** 다만 `부재`의 의미와 5초 timeout의 적용 범위를 아래처럼 고정해야 잘못된 readiness 요구나 거짓 PASS를 피할 수 있습니다. 새 사용자 결정은 필요하지 않습니다.

아래는 부모가 저장할 **validation-v1 제안 전문**입니다. 이번 검토는 정적 읽기만 수행했으며 실행 판정은 모두 **NOT_RUN**입니다.

## Health validation v1

### 범위와 구조 게이트

기준은 `35104776c1ae4f42696d06e0e836ead29a786fb3`이다. 공개 `GET /api/health`의 기본 PG 연결 확인을 유지하면서, 명시 scope에서만 Mongo ping을 사용한다. R1/R2/R4/R5/R6 적용, R3 비적용, 5/6 Level3이다.

| 구조 | 수락 조건 | 현재 정적 판정 |
|---|---|---|
| S1 태그 | 원본 고정은 Shell, 포트·선택·GET은 Core, 실행·정리는 Check로 구분한다. | 충족 |
| S2 핵심 | 실제 GET → 선택한 repository → PG `SELECT 1` 또는 Mongo `{ping:1}`의 완결 경로를 검증한다. | 충족 |
| S3 조건부 규칙 | 명시 scope 누락 시 fallback 금지, 공개 오류 고정, 무쓰기·borrowed client 보존, 원본 대비 의도적 차이와 재사용 증거를 구분한다. | 아래 기준으로 구체화 |

구조 게이트가 실패하면 실행 성공 개수로 대체 수락하지 않는다.

**경계 해석을 고정한다.**

- `부재`는 설정·포트 누락과 연결 불가를 구분한다. **허용된 이름의 비어 있거나 아직 생성되지 않은 Mongo DB에 대한 ping 성공은 정상**이다. 컬렉션 존재를 요구하거나 health가 DB를 생성해서는 안 된다.
- 5초 CSOT는 계획의 **Mongo check**에 적용한다. 기존 PG에 새 5초 제한을 추가하는 요구가 아니다.
- 키 형식 검증은 복호화 가능성 검증이 아니다. 유효 형식의 다른 키를 업무 데이터 조회 없이 판별한다고 주장하지 않는다.

### V1 — 원본·공개 API 계약〔R1/R6〕

- 기준 SHA의 원본 route와 실행 의존성을 고정하고 hash/loader 경계를 기록한다. 원본을 현재 변경 구현으로 우회하지 않는다.
- 실제 원본 GET과 현재 기본 PG GET의 production 결과를 독립 literal과 각각 비교한다.
  - 성공: HTTP 200, JSON `{"ok":true,"database":"connected"}`.
  - 실패: HTTP 503, JSON `{"ok":false,"database":"unavailable","error":"Health check failed"}`.
- JSON content-type과 `dynamic = "force-dynamic"`을 유지한다.
- nonproduction에서는 원본 raw 오류와 현재 고정 오류의 차이를 **의도적 변경**으로 검증한다. 원본과의 무조건 동등성을 요구하지 않는다.
- 공개 접근, proxy 제외, 활동 감사 제외를 유지한다. 기존 matcher와 route-policy 대조 및 실제 GET의 인증·감사 호출 0을 증거로 남긴다.

### V2 — 선택·scope 격리〔R2/R4〕

| 조건 | 필요한 결과 |
|---|---|
| scope 없음 | 기존 PG getter 경유 `SELECT 1`; Mongo 환경값만으로 전환되지 않음 |
| 명시 Mongo health 포트 | 해당 포트 호출, 기본 PG 접근 0 |
| 활성 scope에 health 포트 누락 | GET 503 고정 오류, PG/Mongo 연결 호출 0 |
| 외부 A 안에서 내부 빈 scope | A를 상속하지 않고 실패; 내부 종료 후 A 복원 |
| 동시 A/B | 각 지정 포트·DB로만 호출, 한쪽 실패가 다른 쪽 결과를 바꾸지 않음 |
| 모듈 import만 수행 | 연결·ping·query·close 호출 0 |

실제 context와 기본 PG guard를 유지한다. PG tripwire가 필요하면 **원래 guard 이후** 접근을 계수한다. A/B 검증에 scope별 자격증명이나 새로운 tenant 정책을 도입하지 않는다.

### V3 — 실제 연결과 무부수효과〔R1/R2/R4〕

- 새 소유 loopback PG/Mongo에서 repository와 실제 GET을 연결한다.
- PG는 원래 `getPrismaClient()`의 scope·privacy guard를 통과한 `SELECT 1` 성공을 확인한다. raw 별도 PG client 성공만으로 대체하지 않는다.
- Mongo는 전달된 borrowed client와 명시 shadow DB에서 ping 성공을 확인한다. 업무 조회, DDL, 준비·수정, URI fallback, client close가 없어야 한다.
- 허용된 미생성 DB의 ping 전후에도 DB/컬렉션을 새로 만들지 않는다.
- 잘못된 키 형식과 허용하지 않는 DB 이름은 I/O 전에 거부한다.
- 성공·실패 후 borrowed client를 호출자가 계속 사용할 수 있음을 확인한다.

드라이버 연결 관리 명령과 업무 명령은 구분한다. 관찰자 위반은 GET의 catch에 삼켜지지 않도록 별도 누적 후 단언한다. 35개 모델 준비·업무 읽기·복제본 쓰기 가능성 검증은 요구하지 않는다.

### V4 — 실패·시간 제한·개인정보〔R4/R5〕

- 실제 GET까지 다음 실패를 전달해 HTTP 503과 **전체 고정 응답**을 검사한다: getter/config 오류, PG query 오류, Mongo 연결·command 오류, timeout, 합성 Error/non-Error/cause.
- URI·키·private marker를 합성 오류에 포함한다. 응답과 해당 흐름의 애플리케이션 로그에 원문이 남지 않아야 한다. 환경 행렬은 직렬 또는 worker로 격리한다.
- 실제 연결 실패와 명시 주입 장애를 구분해 기록한다. 실제 드라이버에 도달하지 않은 주입을 native 실패 증거로 계산하지 않는다.
- Mongo command에 5초 CSOT가 전달되는지 확인하고, 실제 지연 또는 드라이버에 위임되는 측정 가능한 지연으로 제한 종료를 확인한다. 실행 시간 허용 오차와 측정 시작점을 명시한다.
- 정상 연결 성공도 함께 확인해 “항상 실패” 구현을 배제한다. `Promise.race` 종료만으로 드라이버 작업 중단이나 socket 취소를 주장하지 않는다.

### V5 — 증거·재사용·완료 게이트〔R6〕

- 필수 증거: 원본/API 비교, scope 격리, 실제 PG·Mongo GET, 실패·timeout, 무쓰기·client 소유권.
- 최소 음성 대조는 잘못된 응답 literal과 잘못된 backend 호출이 검증기에 걸리는지 확인한다. 실패 응답만 맞으면 통과하는 검사는 불충분하다.
- 일반 test/typecheck/lint/build와 독립 코드·증거 검토를 기록한다. 기존 context/privacy/활동 정책 검증은 변경 여부와 hash·실행 근거를 명시해 재사용할 수 있다. 새 health 경로 실행을 재사용으로 대체할 수 없다.
- 소유 자원 정리 결과와 미실행·skip·실패를 구분한다. 통합 및 원격 일치는 실제 완료 후 별도로 기록한다.
- 수락은 **health 연결 경계 구현**에 한정한다. 전체 앱 readiness, 데이터 복호화, 백업·복구, 운영 cutover 또는 main 준비 완료를 의미하지 않는다.

**현재 판정:** 계획 구조는 수락 가능하며 위 경계 명확화를 권고한다. 구현·DB·테스트 실행 수락은 **NOT_RUN**이다.
