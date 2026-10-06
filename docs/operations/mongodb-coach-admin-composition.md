# 코치 관리자 Mongo composition

2026-10-01 기준 코치 관리자 페이지의 삭제 수, 분야·커리큘럼 마스터 GET/POST, 삭제 코치 목록·복원·명시적 영구삭제 API에 `COACH_ADMIN_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 coach-admin runtime을 연다.

기존 soft-delete·복원과 관리자 영구삭제 의미는 바꾸지 않았다. 실제 로컬 MongoDB에서 분야·커리큘럼 생성, 삭제 코치 복원·영구삭제, request/business audit, 관리자 권한, PG 접근 0과 부분 namespace 불변을 확인했다. 운영 selector·운영 데이터·브라우저 전체 흐름·최종 전환은 미완료다.
