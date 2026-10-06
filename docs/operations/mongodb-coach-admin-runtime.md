# MongoDB 코치 관리자 runtime

코치 관리자 페이지의 마스터 분야·커리큘럼과 삭제 코치 목록·복원·영구삭제를 요청 감사와 같은 명시 Mongo shadow runtime으로 조립한다. 기존 인증, 소프트 삭제, 확정된 영구삭제 Cascade/SetNull, 업무 감사 계약과 생산 기본 PostgreSQL을 유지한다.

## 포함 포트

- `coachAdmin`
- `requestActivity`

두 포트는 호출자가 빌려준 같은 `MongoClient`, database, namespace를 사용한다. `prepareMongoCoachAdminRuntime`은 알려진 collection이 없는 새 shadow만 request audit→coach admin 순서로 준비한다. 준비된 namespace는 쓰지 않고 전체 readiness를 확인하며 부분 준비·오래된 정책은 자동 수리하거나 삭제하지 않는다.

## 확인한 범위

새 로컬 MongoDB 8.0.30 replica set과 합성 키·데이터에서 실제 페이지와 API를 통해 다음을 확인했다.

- 관리자 페이지의 삭제 코치 수와 탭 전달
- 마스터 목록·공백 정규화 생성
- 삭제 코치 목록·복원·영구삭제와 기존 DTO
- 업무 변경 감사와 요청 감사의 request ID·actor·status 귀속
- 저장 문서의 코치 이름·삭제자·관리자 식별 문자열 평문 비노출
- 준비된 namespace 재실행·open의 mutation 0
- 실제 준비 중단 namespace의 재실행 거부·mutation 0·snapshot 불변
- 등록 scope 포트 누락과 다른 namespace 중첩 전환의 callback 전 차단
- PostgreSQL 접근 0과 borrowed client 유지

브라우저 전체 상호작용, production selector, 운영 namespace·부하·실데이터 이전·복원·최종 전환은 검증하지 않았다.
