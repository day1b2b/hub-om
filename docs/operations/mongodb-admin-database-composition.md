# 관리자 DB Mongo composition

2026-10-01 기준 관리자 DB 페이지와 셀 수정 API에 `ADMIN_DATABASE_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 admin-database runtime을 연다. 페이지 조회의 `adminDatabase`·`teamMembers`와 PATCH의 `adminDatabase`·`requestActivity`는 등록된 같은 잠금 scope를 사용한다.

실제 로컬 MongoDB에서 페이지 조회, 셀 수정, request/business audit, rollback 계약, 관리자 권한, PG/local 접근 0과 부분 namespace 불변을 확인했다. 운영 selector·운영 데이터·브라우저 전체 상호작용·최종 전환은 미완료다.
