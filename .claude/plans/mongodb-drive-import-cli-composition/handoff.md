# Drive 가져오기 CLI composition 인계

기존 Mongo Drive writer를 실제 `drive:import:dry-run` 명령의 exact selector에 연결한다. 기본은 PostgreSQL이며 Mongo는 준비된 shadow만 연다. dry-run도 이력은 쓰므로 부분 namespace를 source 호출 전에 거부한다.

합성 Mongo의 실제 `.mjs` 성공·실패 프로세스와 전체 회귀 결과는 execution-review를 따른다. 실제 Google Drive·운영 명령·예약·배포·백업·복구·운영 이전은 수행하지 않았다. 독립 리뷰와 첫 통합 SHA는 integration-review에 기록한다.
