## 활동 로그 정리 validation v1

### 범위와 구조 판정

기준은 `b333931a2e7d281b697baf20a75bdf13b8e2b094`이다. 대상은 `activity:prune` CLI와 기존 `MongoRequestAuditRepository.pruneActivityBatch`이며, 두 경로가 원자적 배치 helper를 공유한다. 삭제 대상은 `ActivityRequest`·`ActivityChange` 두 모델로 제한한다. R1/R2/R4/R5/R6 적용, R3 비적용, 5/6 Level3이다.

| 구조 | 수락 기준 | 정적 판정 |
|---|---|---|
| S1 태그 | 원본·서버 시계 확인은 Shell, repository·CLI·API 연결은 Core, 실행·정리는 Check | 충족 |
| S2 핵심 | 실제 entry → 저장소 선택 → 원자적 배치 → 반복·집계 → 출력·종료까지 연결 | 충족 |
| S3 조건부 규칙 | 서버 시간, 재시도·commit 불명, 부분 commit, 소유권, API 기존 차이의 수정 범위가 명확 | 충족 |

**계획 구조를 수락한다.** 기존 Mongo API의 클라이언트 시계·순차 삭제 차이는 이번 공유 helper 연결로 수정해야 하며, 잔여 범위로 제외할 수 없다. 새 보존·삭제 정책이나 schema 변경은 없다.

부모는 Mongo 8.0.30의 snapshot transaction 안에서 collectionless aggregate가 Date를 반환하는 기술 게이트 성공을 보고했다. 증거는 `/private/tmp/hub-om-activity-prune-20260930/clock-gate.json`이다. 이번 리뷰에서는 해당 실행 증거를 독립 확인하지 않았으므로 **부모 실행 보고**와 **독립 검토 완료**를 구분한다.

### V1 — 원본·반환·삭제 집합〔R1/R6〕

- 원본 script, retention, getter/privacy 및 실행 의존성을 기준 Git 객체·hash로 고정한다. 원본 실행이 변경 구현을 불러오는 경로를 차단한다.
- frozen PG/current PG/native에 독립 합성 fixture를 사용한다. 기대 삭제 집합·잔존 전체 행·계수는 새 helper에서 계산하지 않는다.
- 보존 기준은 요청 30일, 변경 365일이며 **`occurredAt < cutoff`**다. 정확한 경계는 남기고 이전 값만 삭제한다.
- 모델별 날짜 오름차순 최대 1,000개다. 동률 경계에서는 허용 후보 집합과 개수·날짜 조건을 검증하고 특정 ID 선택을 강제하지 않는다.
- 빈 데이터, 새 데이터만 존재, 한 모델만 만료, 양쪽 만료, 999/1000/1001 경계를 포함한다.
- 양쪽 결과가 모두 1,000 미만이면 종료한다. 어느 한쪽이라도 정확히 1,000이면 다음 배치를 호출한다. 성공한 전체 drain 후 재실행 합계는 0이다.
- `ActivityChange.requestId`는 FK가 아니다. 요청 삭제로 아직 보존해야 할 변경 이력이 연쇄 삭제되지 않아야 한다.
- 결과는 삭제 수와 삭제 후 **전체 raw 행 다중집합**으로 검증한다. 남은 행의 암호문·보조 필드가 변경되지 않아야 한다.

### V2 — 서버 시계·원자성·재시도〔R1/R4/R5〕

**서버 시계 기준**

- 실제 사용 경로는 같은 session의 snapshot transaction 안에서 다음 collectionless aggregate를 실행한다.

  ```ts
  db.aggregate(
    [
      { $documents: [{}] },
      { $project: { _id: 0, serverNow: "$$NOW" } }
    ],
    { session }
  )
  ```

- 반환값이 유효한 Date인지 확인하고 **callback 시도마다 한 번** 얻어 두 cutoff에 공유한다. callback 재시도는 새 서버 시각을 얻되, 한 시도 안에서는 고정한다.
- 두 collection이 비어 있어도 동작해야 한다. 새 시계 collection·필드를 만들거나 app `Date.now()`를 cutoff의 근거로 사용하지 않는다.
- 기술 게이트 증거에는 서버 버전, transaction/session 사용, 반환 Date, 종료 결과가 있어야 한다. 게이트 성공만으로 실제 helper 연결까지 검증했다고 주장하지 않는다.
- PG `now()`의 정밀도와 Mongo 밀리초를 동일하다고 가정하지 않는다. 경계에서 충분히 떨어진 fixture로 backend 대조를 하고, 정확한 경계는 관찰·통제한 각 backend 기준시각으로 별도 검증한다. 합성 시계 주입은 실제 서버 시계 증거와 구분한다.

**배치·재시도 상태표**

| 상황 | 필수 결과 |
|---|---|
| 정상 배치 | 동일 transaction·동일 서버 시각에서 두 cutoff 계산, 실제 삭제 수 반환 |
| 두 번째 삭제 실패 | 해당 배치 첫 삭제도 rollback, 성공 계수 반환 없음 |
| 첫 배치 commit 후 다음 배치 실패 | 앞선 삭제는 유지, 실패 배치만 rollback, CLI 성공 합계 JSON 없음 |
| callback transient 재시도 | 시도별 cutoff·계수 지역화, 이전 시도 rollback, 최종 성공 수만 한 번 집계 |
| commit ACK 재시도 | callback 재시도와 구분, 확정된 결과만 한 번 집계 |
| commit 결과 미확정 | 고정 실패 전파, 삭제 0·rollback 확정이라고 주장하지 않음 |
| 동시 drain | 성공 계수와 실제 삭제 집합 일치, 중복 집계 없음, 보존 대상 유지 |

- 드라이버 transient label은 transaction 내부에서 일반 Error로 바꾸지 않는다. 고정 오류 변환은 재시도 경계 밖에서 한다.
- CLI 배치 10초 예산은 callback 재시도마다 초기화하지 않는다. 작업에는 남은 예산을 전달하고 cleanup 5초를 구분한다.
- commit 불명 사례는 후속 독립 raw 관찰로 상태를 확인한다. 관찰 전에 fixture 복구로 상태를 덮어쓰지 않는다.
- 전체 drain 원자성·경쟁 중 새로 삽입되는 모든 로그의 완전 소진·exactly-once를 새 보장으로 요구하지 않는다.

### V3 — 실제 CLI·scope·종료〔R2/R4/R5〕

- 기존 npm entry의 실제 subprocess로 성공 JSON `deletedRequests/deletedChanges`, 종료 코드, 실패 출력과 close를 검사한다.
- 기본 경로는 기존 `.env.local → .env`, `override:false` 의미를 유지한다. 이미 설정된 환경값의 우선순위도 검사한다. 환경 fixture는 합성 전용 디렉터리에서 사용한다.
- 명시 scope는 env loader를 호출하지 않는다. scope의 `activityPrune` 누락은 env·DB 접근 전에 거부하며 PG fallback이 없어야 한다.
- import만으로 env 읽기·연결·출력·정리가 발생하지 않는다. 기존에 무시하던 argv를 새 정책 옵션으로 해석하지 않는다.
- 중첩 scope는 외부와 병합하지 않고, 동시 A/B는 서로 다른 지정 범위에만 삭제한다.
- 실패 출력은 `ACTIVITY_PRUNE_FAILED`로 고정하고 exit 1이다. 원문 Error/non-Error/cause·URI·키·합성 개인정보 marker를 출력하지 않는다.
- PG는 실제 초기화한 client만 정리한다. 초기화 전 실패에도 불필요한 client를 만들지 않는다. Mongo borrowed client는 닫지 않는다.
- close 실패 역시 고정 실패·exit 1이다. **성공 출력과 close의 순서는 원본과 대조해 명시한다.** 원본은 합계를 출력한 뒤 finally에서 disconnect하므로, close 실패 때 이미 출력된 합계를 원본에도 없던 것으로 취급하지 않는다.
- 직접 command 함수 호출만으로 실제 entry의 env 순서·exit·종료 검증을 대체하지 않는다.

### V4 — 요청 감사 자동 정리의 원자성 수정〔R1/R4/R5〕

이 항목은 이번 범위의 **필수 수락 기준**이다.

- 기존 Mongo의 모델별 `Date.now()`·순차 삭제를 공유 helper의 서버 시각 한 번·동일 transaction으로 교체한다. 기존 PG 동등성 결함의 수정으로 기록한다.
- 실제 `withActivity → recordRequest → prune` 경로를 사용한다. 요청 기록은 정리보다 먼저 완료되며, 정리 실패 때문에 이미 기록한 요청이나 업무 응답을 rollback하지 않는다.
- 두 번째 삭제 실패 시 만료 로그 두 모델 모두 해당 배치 rollback이다. 외부 응답은 기존 best-effort 의미를 유지하고 고정 retention 실패 로그만 남긴다.
- 자동 정리는 한 배치이며 CLI처럼 backlog 전체를 drain하지 않는다.
- 기존 시간당 실행 조건과 실패 후 재시도 시점 의미를 유지한다. prune cutoff의 서버 시각과 실행 주기 제한용 로컬 시계를 구분한다.
- 자동 정리 transaction **총 4초·개별 작업 1500ms**를 CLI **배치 10초**와 구분해 전달·검증한다. 재시도로 총예산을 초기화하지 않는다. cleanup을 포함한 HTTP 전체 응답 4초 보장으로 확대하지 않는다.
- 새 소유 로컬 URI를 지원 환경변수로 전달해 실제 `mongoApiContext`·`adminDatabaseHandlers` 회귀를 실행한다. 기존 fixture의 다른 DB나 운영 연결로 fallback하지 않아야 한다.
- `recordAccess` 등 인접 감사 동작을 바꾸지 않는다. 변경되지 않은 경로는 hash·기존 실행 근거로 재사용할 수 있으나, 변경한 자동 정리의 실제 API 회귀를 대신하지 못한다.

### V5 — 준비·증거·완료〔R4/R6〕

- 새 repository는 두 모델만 준비·조회·삭제한다. runtime `allowShadowWrites:true`, shadow DB/namespace, 키 형식, validator/index·replica 요건을 확인한다.
- 기존 불일치에 자동 수리·삭제를 하지 않는다. 새 CLI 때문에 기존 요청 감사의 별도 준비 범위를 두 모델로 축소하지도 않는다.
- 실제 DB fault, 라벨 주입, 시계·ACK 주입을 각각 표시한다. native 특정 오류 번호를 무조건 강제하지 않는다.
- 금지 호출·세션 종료·raw 불변 관찰은 제품 catch 밖에서 단언한다.
- 같은 검증기로 cutoff 포함 오류, 한쪽 삭제만 commit, 계수 중복, 누락 잔존 행, 민감 출력이 실패하는 음성대조를 둔다.
- 실제 PG/native 배치와 CLI, 변경한 API 경로는 신규 증거가 필요하다. 기존 codec·privacy·context 검증은 hash와 실행 근거로 재사용하되 신규 경로를 대신하지 않는다.
- 일반 test/typecheck/lint/build, 독립 검토, 실패 로그 보존, 소유 자원 정리·영속 증거를 기록한다.
- 수락은 합성 환경의 활동 로그 정리 구현에 한정한다. 운영 삭제 실행·실제 스케줄 설치·자동화 재개·운영 전환 완료를 의미하지 않는다.

**현재 판정:** 공유 API 범위를 반영한 S1–S3 계획 구조를 수락한다. 서버 시계 기술 게이트는 부모가 성공을 보고했으며 독립 증거 검토는 아직이다. 나머지 구현·실행 최종 수락은 미완료다. 이번 검토에서 파일 수정·DB 접속·테스트 실행은 하지 않았다.
