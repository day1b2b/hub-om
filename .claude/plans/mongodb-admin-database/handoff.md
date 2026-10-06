# 관리자 DB 작업 인계

기준 4db4cf685f5632ecb1156c57b1a6992502c0589c. 기능 브랜치 feature/20260929-mongodb-admin-database. Lifecycle completed, artifact complete, resume next_scoped_task. 격리 clone /Users/ga/workspace/hub-om-mongodb-coach-content. 원본 workspace는 수정하지 않는다.

구현 완료: 8표 조회·4표 allowlist 편집의 adminDatabase 경계와 실제 페이지 담당자 목록의 stored teamMembers 경계. 기본 PG 및 권한·DTO·파서·오류를 유지한다. 공통 presenter와 별도로 원본 전체 PG oracle을 byte 동결했다. Mongo snapshot/부분 갱신/암호화·HMAC/unique/원자적 감사 및 기존 writer 재시도 구현. 운영에 적용하지 않았다.

plan-v2/validation-v2 독립 수락 후 실행했다. 전체 Mongo 회귀 및 V3 추가 검증/최종 독립 수락 PASS. 결과와 실패·수정·한계는 execution-review, 범위는 운영 문서, 최종 SHA는 integration-review를 확인한다. 이미 완료된 구현이나 이전 전환 단위를 반복하지 않는다.

소유 runtime /private/tmp/hub-om-admin-database-20260929, PG56659/admin_database_parity, Mongo27759/admindatabase20260929. 최종 검사 후 cleanup exit0, 합성DB0·두 소유 dbpath 제거/부재 확인 완료. 로그·스크립트만 보존한다.

다음 기능은 coverage 기준으로 고른다. 작은 후보는 공지·첨부이며 기존 권한·첨부 다운로드·저장 암호화·삭제 계약을 먼저 계획/검증한다. OM 접수·가져오기·캘린더·매출·활동 조회·백업/health·실제 데이터 복사·복원 리허설·최종 운영 전환은 남아 있다. 일반 getTeamMemberRepository의 Notion 정책과 브라우저 초안 암호화도 이번 범위 밖이다.

Do Not: 운영/실원천/원본 workspace/실키/env/권한/배포 변경, 자동화 재개, 전체 완료 전 dev→main 병합. 생산 기본 PG 유지. 전체 앱/운영 이전 미완료.
