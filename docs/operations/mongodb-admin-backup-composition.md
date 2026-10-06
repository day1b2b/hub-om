# 관리자 백업 Mongo composition

2026-10-01 기준 `/api/admin/backup`에 `ADMIN_BACKUP_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 `adminBackup`과 `requestActivity`를 같은 잠금 scope로 연다. 권한·다운로드 계약과 승인 응답의 복호화 값을 유지한다.

실제 로컬 MongoDB에서 빈 합성 export, 요청 감사, PostgreSQL 연결 0건과 부분 namespace 전체 metadata·index·행 불변을 확인했다. 이는 기존 코치 JSON 다운로드이며 전체 DB 복구 백업이나 운영 A/B 백업이 아니다.
