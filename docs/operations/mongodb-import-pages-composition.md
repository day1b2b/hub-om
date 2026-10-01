# 가져오기 관리 화면 Mongo composition

2026-10-01 기준 `/admin/imports`와 `/admin/imports/[id]`에 `IMPORT_PAGES_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 준비된 `imports` 저장소를 요청 단위 잠금 scope로 연다. 목록·상세 조회의 기존 DTO와 관리자 권한, 없는 실행의 404, 비관리자 리다이렉트를 유지한다.

실제 로컬 MongoDB 8.0.30 replica set에서 빈 목록, 없는 상세의 404, 비관리자 리다이렉트, PostgreSQL 연결 0건을 확인했다. 일부 collection만 존재하는 namespace는 validator·index·행을 바꾸지 않고 거부했다. 설정·연결·runtime 오류는 `IMPORT_PAGES_COMPOSITION_FAILED`로 고정하며 Next.js의 정확한 404·리다이렉트 제어 흐름만 원형대로 전달한다.

생산 기본 backend는 계속 PostgreSQL이다. 운영 namespace, 실제 개인정보, 운영 키·환경·배포 설정에는 접근하지 않았다. 실제 데이터 복사·A/B 백업과 각 복원·최종 전환 및 `dev → main` 병합은 아직 완료되지 않았다.
