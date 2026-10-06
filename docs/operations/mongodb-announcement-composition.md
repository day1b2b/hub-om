# 공지·첨부 Mongo composition

2026-10-01 기준 공지 목록·상세·수정 페이지와 공지 CRUD·첨부 다운로드 API에 `ANNOUNCEMENT_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 `announcements`와 `requestActivity`를 같은 잠금 scope로 연다. 저장소를 사용하지 않는 새 공지 작성 페이지는 불필요한 연결을 열지 않는다.

페이지의 관리자 인증·404·목록 오류 화면과 API의 권한·multipart 제한·HTML 정제·업무 감사·요청 감사·소프트 삭제·첨부 byte 응답 계약을 유지한다. Mongo 설정·연결·readiness·실행 오류는 `ANNOUNCEMENT_COMPOSITION_FAILED`로 고정하고 PostgreSQL로 fallback하지 않는다.

실제 로컬 MongoDB replica set에서 페이지와 API의 생성·조회·수정·첨부 다운로드·소프트 삭제, 암호화 저장과 감사, PostgreSQL 접근 0건, 부분 namespace의 전체 metadata·index·행 불변을 확인했다. 운영 selector·데이터·첨부·배포 설정은 변경하지 않았고 실제 A/B 백업·복원·복사·최종 전환은 별도 단계로 남는다.
