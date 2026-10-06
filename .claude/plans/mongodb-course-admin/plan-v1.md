# 과정 관리자 Mongo 경계 계획 v1

기준: d964cb2559c080653f8dabf5713e0185f100214b. 격리 clone의 feature/20260929-mongodb-course-admin, 시작 변경 없음.

## 범위와 대안

관리자 과정 조회(GET lookup)와 과정 내 활성 운영 건 소프트 삭제(DELETE courseId)만 전환한다. CourseDeletePanel의 권한, 입력 파싱, 응답, 재실행 동작을 보존한다. 과정 자체나 관계 문서는 삭제하지 않는다. 삭제 운영 복원/영구삭제, 과정명 복원, 기타 일괄 작업은 후속 범위다.

OperationRepository 확장과 별도 CourseAdminRepository를 비교했다. 기존 일반 운영/Calendar adapter의 계약을 넓히지 않고 별도 좁은 관리자 저장소와 명시 courseAdmin context를 택한다. 기본 PG는 기존 쿼리 그대로 유지한다. 새 업무 필드·의존성·index·운영 설정은 추가하지 않는다.

## 단계와 수락 기준

1. Core: CourseAdminRepository의 findCourse(processSeq)와 softDeleteCourseSessions(courseId, deletedBy)를 정의한다. 전자는 기존 course DTO 또는 null, 후자는 삭제 개수 또는 과정 부재 null. PG adapter와 factory/context로 두 route를 연결한다. 관리자 인증을 저장소 선택보다 먼저 유지한다. scoped 누락은 PG fallback 없이 실패한다.
2. Core: Company/Course/OperationSession/ActivityChange를 사용하는 Mongo 구현. setup은 명시적으로만, open은 readiness만 검사. snapshot transaction 안에서 읽기·삭제 대상 결정·암호화한 deletedBy와 삭제시각/updatedAt 부분 수정·감사를 수행한다. 기존 삭제된 세션과 다른 과정 및 관계 문서는 그대로 남고 실패 시 전체 rollback. 기존 MongoOperationRepository writer와 공유 세션의 충돌은 transaction retry로 해결한다. 동시 새 세션을 영구 금지하는 새 정책/guard는 도입하지 않는다.
3. Core: 합성 실제 PG 및 Mongo에서 동일 DTO/삭제 개수/actor null/재실행/uppercase UUID/암호화/감사와 오류 동작을 비교한다. 페이지 넘는 삭제, 감사 중간 실패, 동시 삭제·수정, raw 비관련 필드 보존, readiness 실패를 검증한다. 인증/활동 기록 포함 실제 handler 테스트와 defaultPG/scoped missing을 별도로 확인한다.
4. 일반 test/typecheck/lint/build 및 영향받는 실제 Mongo 회귀를 격리 runtime에서 실행한다. 과거 검증은 새 검증을 대체하지 않는다. 실패·skip·미검증은 분리 기록한다.
5. 독립 검토와 필요한 보완을 마친 뒤 coverage/macro/실행·인계를 갱신하고 합성 자원을 정리한다. feature commit/push 및 원격SHA 확인 후 기존 승인에 따라 총괄feature에 통합한다. dev/main 및 운영 전환은 실행하지 않는다.

## 반례·경계

- 저장소 선택은 권한을 주지 않는다. Mongo 오류에 개인정보/원본 driver error가 유출되면 실패다.
- Mongo snapshot에서 동시에 새로 생성되거나 과정으로 이동하는 세션은 이번 삭제 대상에 포함되지 않을 수 있다. PG도 미래 생성을 막지 않는다. 전체 writer 직렬화/운영 freeze 보장은 이번 범위가 아니다.
- Course의 UUID 비교와 processSeq의 PG Int 범위를 실제 PG로 대조한다. 기존 route 파싱 정책을 임의로 바꾸지 않는다.
- 감사가 없는 직접 내부 호출과 withActivity의 요청 감사는 구분한다. 전역 감사 전환 완료를 주장하지 않는다.
- 운영 데이터/원천/키 접근은 없고 새 dbpath·loopback 포트·임시 키만 사용한다.
