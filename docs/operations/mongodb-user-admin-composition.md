# 사용자 관리 Mongo composition

2026-10-01 기준 관리자 사용자 페이지·목록·등록·팀·역할·삭제와 서버간 사용자 조회 API에 `USER_ADMIN_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 user-admin runtime을 연다.

기존 관리자·토큰 권한, 이름·이메일만 반환하는 lookup 계약과 `TEAM_USER_DELETE_POLICY_REQUIRED` 삭제 차단을 유지했다. 실제 로컬 MongoDB에서 페이지·생성·팀/역할 변경·토큰 조회·요청/업무 감사, PG 접근 0과 부분 namespace 불변을 확인했다. 운영 selector·운영 데이터·브라우저 전체 상호작용·최종 전환은 미완료다.
