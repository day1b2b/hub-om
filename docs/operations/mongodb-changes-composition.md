# 변경 내역 Mongo composition

2026-10-01 기준 콘텐츠 피드, 코치 메모 수정·삭제, 투입 평가 수정 API에 `CHANGES_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 changes runtime을 연다. `/api/admin/activity`는 이미 검증된 `ACTIVITY_READ_BACKEND`를 유지해 selector 중첩을 피한다.

실제 로컬 MongoDB에서 성공 쓰기·soft-delete·request/business audit·PG 접근 0, 비인증 리다이렉트·400과 부분 namespace 불변을 확인했다. 운영 selector·데이터·배포·최종 전환은 미완료다.
