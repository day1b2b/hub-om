# 운영 화면 Mongo composition

운영 목록·상세·신규 화면에 `OPERATION_PAGES_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 operation-pages runtime을 open-only로 연다. 요청 중 collection·validator·index를 준비하거나 자동 수리하지 않는다.

실제 MongoDB 8.0.30에서 세 화면의 초기 데이터·담당자·강사·코치·OM 요청·맞춤 도구를 같은 잠금 scope로 조회했다. PostgreSQL 접근과 조회 중 쓰기는 0건이었고 부분 namespace는 무변경으로 거부했다. Mongo 선택에서는 `excel-*` 상세의 로컬 JSON 보조 조회도 차단해 저장소 혼합 없이 404를 유지했다.

운영 selector·실데이터·브라우저 전체 흐름·운영 쓰기 API selector·A/B 백업과 복원·복사·최종 전환은 미완료다.
