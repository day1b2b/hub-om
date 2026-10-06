# 과정명 복원의 Mongo 경계

`courseNameRestore` 서비스와 `/api/admin/course-name-restore`의 미리보기·선택 적용을 repository 경계로 분리한다. 기본은 기존 PG이며 명시 courseNameRestore context에서만 Mongo를 사용한다. 기존 직접 DB 주입은 context 밖에서 유지하고, 명시 context 안에서는 PG 우회를 차단한다. 실제 운영 복원을 실행하는 작업은 아니다.

## 기존 계약

정규화한 코스ID에 속한 기업별 과정과 활성 회차를 조회한다. 원천은 회차별 createdAt 내림차순·id 내림차순의 최신 두 개를 비교한다. 최신 값이 없거나 무효이면 과거 값으로 대신하지 않는다. 원천 시각 동률·현재와 같은 이름·중복 대상·새 과정 메타데이터 충돌은 원래 우선순위와 이유로 차단한다. 메타데이터 충돌은 선택한 회차뿐 아니라 전체 계획을 기준으로 판단한다.

적용은 최초 제출 snapshot을 새 계획과 비교하고 선택한 1~100개의 회차 전체를 검증한다. 기존 대상 과정은 재사용하며 메타데이터를 바꾸지 않는다. 새 과정은 기업·이름별 한 번 생성하고 기존 유형·분류·도구·매출 메타데이터를 복사한다. 회차는 연결과 updatedBy/HMAC·updatedAt만 바꾸고 비관련 암호문·원천·관계·미선택·삭제된 행을 보존한다. 과정·회차·감사·counter 쓰기는 모두 함께 성공하거나 취소된다. 오래된 계획으로 재시도하면 409로 재조회를 요구한다.

## 동시성·저장 구조

단순 snapshot에서 서로 다른 회차를 선택한 동시 복원이 둘 다 성공하는 문제를 막기 위해, 기존 guard 패턴을 따르는 내부 `CourseNameRestoreGuard` singleton을 추가한다. 업무 필드·PG migration·35개 업무 모델 계약은 바꾸지 않는다. 과정 번호 counter를 잠금 목적으로 소비하지 않는다.

매 적용과 재시도는 같은 transaction에서 guard의 새 nonce를 쓴 뒤 계획을 읽고 최초 제출 snapshot과 비교한다. 조회는 guard를 바꾸지 않는다. guard는 지문에서 제외하여 무관한 코스ID 작업만으로 계획이 오래됐다고 판정하지 않는다. 초기 guard 생성 경쟁도 재시도 전체 제한 안에서 처리한다. 일반 writer가 같은 선택 회차를 수정하면 실제 쓰기 충돌 후 새 상태를 검사한다. 이 guard가 모든 미전환 writer의 PostgreSQL Serializable 의미까지 보장하는 것은 아니다. 미래 원천·import writer는 전환 시 함께 검증해야 한다.

prepare에서만 내부 guard와 기존 validator/index/counter를 준비한다. open이나 업무 호출은 자동 생성·수리·삭제를 하지 않는다. 기존 준비 상태가 다르면 실패한다. 운영 selector나 환경설정은 추가하지 않는다.

## 지문과 한계

PG 원본 쿼리와 지문 직렬화는 유지한다. 실제 합성 PG 검사에서 COMMIT 시 adapter-pg가 직접 던지는 serialization/deadlock 오류를 확인하여, DriverAdapterError/TransactionWriteConflict/SQLSTATE40001 또는40P01이 일치할 때 기존 재조회409로 변환한다. 그 밖의 오류는 그대로 내부 오류로 처리한다. Mongo 지문은 원본 readPlan이 사용하는 논리 데이터 범위로 결정적으로 계산하고 암호문·HMAC·guard를 제외한다. 두 backend의 지문 문자열이 같거나 서로 교환 가능하다고 보장하지 않는다. 이미 열린 계획은 해당 backend에서 재검증한다.

PG 적용의 기존 timeout15초/maxWait5초는 유지하고 Mongo는 모든 재시도를 포함해 30초로 제한한다. 공통 scan에는 15초·2만 행·32MiB 제한이 있다. 이 차이는 가용성 한계이며 운영 성능 동등성을 의미하지 않는다. 초과나 실패를 부분 성공으로 반환하지 않는다.

구현·실제 합성 검사·독립 리뷰·원격 통합의 최신 상태는 `.claude/plans/mongodb-course-name-restore/`에 기록한다. 브라우저/OAuth E2E·실제 데이터·원천·운영 부하·복구 리허설·운영 전환은 별도이며 이번 기능 경계가 전체 앱 전환 완료를 뜻하지 않는다.

OM 전체 배정도 같은 guard 문서를 공유하도록 연결한다. 배정이 전체 연결 회차를 읽고 일부만 변경하는 경우와 복원이 전체 계획을 읽고 선택 회차만 이동하는 경우의 역의존을 보호한다. 배정의 구현·검증 상태와 직렬화 범위는 [OM 배정 경계](mongodb-om-assignment.md)를 따른다.
