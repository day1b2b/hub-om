# 과정 관리자 조회·소프트 삭제 경계

`GET /api/admin/courses/lookup`과 `DELETE /api/admin/courses/[courseId]`는 `CourseAdminRepository`를 사용한다. 기본은 기존 PostgreSQL adapter이며 내부 검증에서 명시한 `courseAdmin` context만 Mongo를 사용한다. 요청 헤더·환경변수로 backend를 선택하지 않으며 저장소 주입은 관리자 권한을 부여하지 않는다.

## 유지하는 동작

과정 조회는 기존 PRC 번호 파싱과 회사명·과정명·활성 운영 건 수 응답을 유지한다. 과정이 없으면 404다. “과정 삭제”는 해당 과정의 `deletedAt=null` 운영 건에 삭제시각·삭제자를 남기는 기능이며 Course를 물리 삭제하지 않는다. 이미 삭제된 건과 다른 과정, 관계 문서는 보존한다. 활성 건이 없거나 정상 재실행하면 성공 건수 0이다. 복원·영구삭제 정책을 추가하지 않는다.

Mongo는 준비된 새 shadow namespace와 replica set에서만 검증한다. 명시 setup이 validator/index를 준비하고 open은 확인만 한다. 읽기는 같은 snapshot에서 과정·회사·활성 수를 확인한다. 삭제는 대상 운영 건과 변경 감사를 같은 transaction에 기록하며 삭제자 암호문과 HMAC을 함께 갱신한다. 비관련 필드의 저장 암호문은 다시 쓰지 않는다. 실패하면 부분 삭제 없이 전체 원복한다.

공통 scan은 한 번에 100행씩 읽으며 전체 20,000행·32MiB·15초 제한을 적용한다. 조회 건수도 전체 인증·복호화한 문서를 기준으로 세므로 같은 제한을 받는다. 초과는 일부 건수 성공이 아닌 오류다. 조회 transaction은 재시도 포함 30초, 삭제는 60초 예산이며 부하나 성공시간 보장이 아니다.

## 경합·감사·한계

일반 Mongo 운영 writer와 같은 문서 수정이 겹치면 transaction 충돌 후 대상 조건을 다시 읽는다. 새로운 과정 잠금이나 전체 writer 직렬화 정책은 추가하지 않는다. snapshot 이후 생성되거나 해당 과정으로 들어온 운영 건을 이번 삭제에 모두 포함한다는 보장은 없다. 운영 freeze나 향후 생성 금지는 별도 기능이다.

업무 변경 감사는 원자적으로 저장한다. `withActivity`의 요청 로그는 기존처럼 업무 이후 최선형 기록이므로 후행 로그 장애가 성공한 삭제를 취소하지 않는다. requestActivity 구성 누락은 업무 전에 실패한다. 내부 직접 호출에 activity context가 없으면 새 감사 주체를 임의로 만들지 않는다. 전역 활동 기록 전체 이전과는 구분한다.

실행 증거와 시간·자료량 한도 및 미검증은 `.claude/plans/mongodb-course-admin/execution-review.md`를 따른다. 이 구현은 운영 적용·실제 데이터 이전·복원 리허설 완료가 아니다. 삭제 운영 복원/영구삭제, 과정명 복원, 관리자 일괄 보정, 가져오기·캘린더·공지 등은 coverage 기준으로 남아 있다. schema/migration/dependency/운영키·배포 설정 변경은 없다.
