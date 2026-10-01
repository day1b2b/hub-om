# Drive 조회 화면 Mongo composition

2026-10-01 기준 `/drive-import-runs`에 `DRIVE_IMPORT_PAGE_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 `driveImportHistory`와 `teamMembers` repository를 같은 요청 단위 잠금 scope로 연다. 기존 workspace 권한, 팀 범위, 최근 실행 DTO와 빈 상태를 유지한다.

실제 로컬 MongoDB 8.0.30 replica set에서 빈 화면, 비로그인 리다이렉트, PostgreSQL 연결 0건을 확인했다. 일부 collection만 있는 namespace는 validator·index·행을 바꾸지 않고 거부했다. 설정·연결·runtime 오류는 `DRIVE_IMPORT_PAGE_COMPOSITION_FAILED`로 고정하며 정확한 Next.js 리다이렉트만 원형대로 전달한다.

이 범위는 저장된 Drive 조회 이력을 보여주는 읽기 화면이다. 실제 Drive 조회 실행, 운영 원천, 운영 namespace, 키·환경·배포 설정에는 접근하지 않았다. 생산 기본 backend는 계속 PostgreSQL이며 실제 데이터 복사·A/B 백업과 각 복원·최종 전환 및 `dev → main` 병합은 미완료다.
