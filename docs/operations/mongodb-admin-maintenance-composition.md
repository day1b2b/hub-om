# 관리자 유지보수 Mongo composition

2026-10-01 기준 과정 조회·소프트 삭제, 삭제 운영 조회·복원, 현장 투입·OM 배정 상태 보정 API에 `ADMIN_MAINTENANCE_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 admin-maintenance runtime을 연다.

기존 소프트 삭제·복원·보정 범위와 관리자 권한은 바꾸지 않았다. 실제 로컬 MongoDB에서 연속 흐름, 각 GET/POST/DELETE/PUT의 request audit, 네 변경의 business audit, PG 접근 0과 부분 namespace 불변을 확인했다. 운영 selector·운영 데이터·브라우저 전체 상호작용·최종 전환은 미완료다.
