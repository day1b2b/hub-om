**부모가 확정한 차이를 반영하면 계획 방향과 S1–S3 구조를 수락할 수 있습니다.** 새 정책 결정은 필요하지 않습니다. 다만 plan-v1의 “id별 비교”는 복합키 모델까지 포함하도록 교정하고, 고정 실패의 정확한 코드·전파 방식을 구현 전에 명시해야 합니다.

아래는 validation-v1 전문입니다.

## 관리자 백업 validation v1

### 범위·구조 판정

기준 SHA는 `f0b3e479d140a81e78f2a73ddf7c74063fd8e14f`이다. 기존 `POST /api/admin/backup`의 승인된 JSON 다운로드를 기본 PG와 명시 Mongo repository로 분리한다. R1/R2/R4/R5/R6 적용, R3 비적용, 5/6 Level3이다.

| 구조 | 수락 조건 | 정적 판정 |
|---|---|---|
| S1 태그 | 원본·의존성 고정은 Shell, repository·실제 POST는 Core, 검증·정리는 Check | 충족 |
| S2 핵심 | 실제 POST → 기존 인증·withActivity → 선택한 repository → 전체 응답·요청 감사 | 충족 |
| S3 조건부 규칙 | 명시 scope, 개인정보 처리, 부분 응답 금지, native 제한·일관성 차이, 원본 독립성·재사용 한계를 구분 | 아래 기준 반영 시 충족 |

구조 실패는 테스트 개수로 상쇄하지 않는다. 다음은 확정된 의도적 차이이며 새 사용자 승인 사항이 아니다.

- Mongo만 요청 누적 20,000행·32MiB·60초, 개별 작업 15초·cleanup 5초 제한을 적용한다. 초과하면 전체 실패하며 PG에는 새 제한을 추가하지 않는다.
- Mongo 단일 snapshot 읽기는 일관성 보완이다. 원본 PG `Promise.all`이 동일 보장을 제공한다고 주장하지 않는다.
- 저장소·codec 오류의 고정 공개 오류 변환은 개인정보 보호 목적의 변경이다. 기존 인증 오류 제어 흐름은 유지한다.
- snapshot metadata는 선택한 6필드만 조회·검증한다. `errorMessage`를 읽거나 복호화하지 않는다.

### V1 — 원본과 전체 응답 동등성〔R1/R6〕

- 원본 route와 실제 getter/privacy/activity/auth의 실행 의존성을 기준 Git 객체·hash로 고정한다. 원본이 변경 구현을 불러오는 경로를 차단한다.
- 합성 데이터로 frozen PG/current PG/Mongo의 실제 POST 결과를 각각 독립 literal과 비교한다. 기대값은 새 repository·codec·응답 builder에서 생성하지 않는다.
- 비교 범위는 HTTP 성공 상태, `dynamic`, JSON content-type, attachment 파일명, `exportedAt`, 전체 `counts/data`, `X-Request-Id`와 감사 연결이다.
- 시계·요청 ID처럼 통제하거나 관계로 검증할 값만 정규화한다. 실제 데이터의 날짜·null·필드를 제거해 비교하지 않는다.
- 11개 배열은 순서 없는 **전체 행 다중집합**으로 비교한다. 일반 모델은 실제 PK, `CoachPrivateProfile`은 `coachId`, `CoachField`·`CoachCurriculum`은 `(coachId,tagId)`를 사용한다. Map 덮어쓰기로 중복·누락을 숨기지 않는다.
- 빈 데이터, soft-delete 행, nullable·비-null 날짜, enum/boolean/number, JSON 객체·배열·null을 포함한다. counts는 각 배열 길이와 일치해야 한다.

### V2 — snapshot metadata와 개인정보 경계〔R1/R4〕

- snapshot은 모든 상태를 대상으로 `started_at DESC`, 최대 20개를 반환한다. `completed` 필터를 추가하지 않는다.
- 정확한 필드는 `id`, `table_count`, `row_count`, `status`, `started_at`, `finished_at`이다. snake_case와 nullable 직렬화를 유지한다.
- 서로 다른 시각의 21개 이상 fixture로 최근 20개 선택을 검증한다. 동률은 내림차순·중복 없음·허용 후보 집합으로 검사하며, 20번째 경계의 동일 시각 후보 중 특정 ID 선택을 강제하지 않는다.
- **snapshot의 비선택 `errorMessage`가 손상돼도 선택 6필드가 유효하면 성공해야 한다.** 해당 필드는 조회·복호화·검증하지 않는다. 반대로 선택 필드의 잘못된 타입은 native 검증 실패로 구분한다. 전체 문서 decoder에 부분 projection을 넣는 방식은 사용하지 않는다.
- 11개 모델은 원본 Prisma 개인정보 wrapper의 결과와 전체 공개 scalar를 비교한다. 승인된 `accessToken`, 개인정보·원천 ID 등을 새롭게 제거하지 않는다.
- Mongo `_id`·내부 metadata·HMAC·암호화 companion 필드는 응답에 남지 않는다. 단, 사용자 JSON 내부의 같은 이름 키를 무차별 제거해서는 안 된다.
- 합성 개인정보는 승인 응답에 복호화되어 나타나되, 저장 시 기존 암호화 정책을 유지한다. 새 오류·로그·감사 payload에 백업 본문이나 credential이 추가되지 않아야 한다.

### V3 — 실제 인증·scope·요청 감사〔R2/R4〕

실제 `assertCoachPiiAccess`, context, factory, 기본 PG guard, `withActivity`를 유지한다. 세션 공급과 합성 secret만 제어한다.

| 조건 | 필요한 결과 |
|---|---|
| 정확한 backup Bearer | 세션 권한 단언 없이 승인, `token_request` 감사 |
| 잘못된 Bearer + 허용 세션 | 기존 세션 경로로 승인, 감사 분류는 기존 authorization-header 규칙 유지 |
| secret 없음·불일치 + 미허용 세션 | 기존 인증 오류, 백업 데이터 읽기 0 |
| workspace 소속이지만 ADMIN_EMAILS 미포함 | 거부 |
| ADMIN_EMAILS 미설정 또는 외부 계정 | 거부 |
| scope 없음 | 기본 PG 유지 |
| 명시 adminBackup/requestActivity | 지정 repository만 사용, 기본 PG 접근 0 |
| requestActivity 누락 | wrapper에서 auth·handler 이전 거부 |
| adminBackup 누락 | 승인 요청도 백업 읽기·PG fallback 0; 이미 진입한 wrapper의 감사는 별도 검사 |
| 중첩 빈 scope | 외부 포트 상속 없이 실패, 종료 후 외부 scope 복원 |
| 동시 A/B | 데이터·요청 ID·감사가 각 scope에 귀속 |

- proxy의 backup Bearer 허용과 handler의 실제 권한 판단을 구분해 대조한다. `DEV_AUTH_BYPASS`가 PII guard를 자동 통과시킨다고 가정하지 않는다.
- 거부 요청도 wrapper에 진입했다면 감사가 발생할 수 있다. “데이터 읽기 0”을 “모든 DB 작업 0”으로 바꾸지 않는다.
- 요청 감사 실패는 기존 best-effort를 유지한다. 성공 다운로드를 실패로 바꾸거나 기본 PG에 재기록하지 않는다.
- 백업 대상 업무쓰기 0과 요청 감사·기존 감사 retention 효과를 분리한다.

### V4 — native 읽기·제한·실패〔R4/R5〕

- 읽기 대상은 명시된 12모델이다. `CoachdbArchiveRow`나 나머지 35모델 전체를 추가 조회하지 않는다.
- 준비는 누락 collection 생성만 허용하고 기존 불일치를 자동 수정하지 않는다. 미준비·불일치·부적합 연결의 거부와 읽기 경로의 DDL 0을 확인한다.
- **실제 Mongo에서 읽기 사이에 관련 데이터를 변경하는 barrier를 두고 단일 snapshot의 일관된 결과를 검증한다.** 이는 의도적 Mongo 일관성 보완이다. 원본 PG `Promise.all`의 보장으로 확대하거나, 동시 변경 결과의 backend 간 완전 일치를 요구하지 않는다.
- 행·byte 한도는 모델별로 초기화하지 않는 요청 누적 한도다. 여러 모델에 분산된 합계로도 초과가 검출돼야 한다.
- 행/byte 정확한 경계와 초과, 정상 완료와 지연 실패를 검사한다. byte 계산 대상·방식, metadata 산입 여부, 시간 측정 시작점을 명시한다.
- cursor/getMore 등 후속 작업에서 전체 deadline을 재설정하지 않는다. `Promise.race`만으로 실제 작업 중단을 증명했다고 주장하지 않는다.
- 후반 모델 조회 실패·복호화 실패·선택 metadata 오류·시간/용량 초과에서도 부분 JSON이나 잘린 성공 응답을 반환하지 않는다.
- 모든 종료 경로에서 session/cursor 정리와 borrowed client 보존을 검사한다. 실제 driver 장애와 명시 주입 장애를 구분한다.
- PG/codec 실패의 **정확한 고정 코드와 rejection/HTTP 처리 방식**을 사전에 고정한다. 원본 route에 없는 JSON 4xx/5xx 계약을 임의로 추가하지 않는다. 실제 POST 직접 호출의 reject를 전체 Next HTTP 응답 검증으로 표시하지 않는다.

### V5 — 객관성·재사용·완료〔R6〕

- 최소 음성대조: 누락·추가·중복 행, 잘못된 count, 숨김 필드 유출, 잘못된 backend 호출이 동일 검증기에 의해 실패해야 한다.
- 감사·금지 호출 관찰은 제품 catch 밖에서 누적·단언한다. 고정 오류 응답만 맞는 실패를 성공으로 계산하지 않는다.
- 기존 codec·암호화·context 검증은 hash와 실행 근거로 재사용할 수 있다. backup의 전체 DTO, 6필드 projection, 인증 분기, 실제 POST·감사, snapshot·누적 제한 검증을 대체하지는 못한다.
- 일반 test/typecheck/lint/build, 독립 코드·실행 검토, 소유 자원 정리·증거 보존을 기록한다. 실패·skip·주입·재사용·실제 실행을 구분한다.
- 최종 수락은 기존 코치 JSON 다운로드의 저장소 경계에 한정한다. 전체 DB 백업·복구 가능성, 운영 cutover, main 준비 완료를 의미하지 않는다.

**현재 판정:** 부모의 확정 차이를 반영한 구조·범위는 수락 가능하다. 구현·DB·테스트는 **NOT_RUN**이며, 이번 검토에서 파일을 수정하지 않았다.
