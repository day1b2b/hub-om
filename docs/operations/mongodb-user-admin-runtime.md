# MongoDB 사용자 관리 runtime

관리자 사용자 목록·등록·팀·역할 변경, 서버 간 사용자 조회와 요청 감사를 같은 명시 Mongo shadow runtime으로 조립한다. `teamUsers`와 `requestActivity`는 하나의 borrowed client/database/namespace와 등록·잠금 scope를 사용하며 생산 기본 PostgreSQL은 유지한다.

새 빈 shadow만 request audit→team user 순서로 준비한다. 준비된 namespace와 준비 도중 중단된 namespace는 자동 수리·삭제하지 않고 전체 readiness가 맞을 때만 연다. 로컬 MongoDB 8.0.30에서 실제 API로 권한 확인, 생성, 정규화 이메일 중복 차단, 팀·역할 변경, 토큰 조회의 이름·이메일 전용 응답, 요청·업무 감사, 암호화 저장과 PostgreSQL 미접근을 확인했다.

사용자 삭제는 기존 Mongo repository의 `TEAM_USER_DELETE_POLICY_REQUIRED` 차단을 유지한다. 이번 runtime은 영구삭제 정책을 새로 정하거나 소프트 삭제 schema를 추가하지 않는다. 브라우저 전체 상호작용, production selector, 운영 namespace·부하, 실데이터 이전·복원·최종 전환은 검증하지 않았다.
