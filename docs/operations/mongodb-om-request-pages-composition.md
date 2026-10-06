# OM 요청 화면 Mongo composition

OM 요청 등록·관리·상세·수정·완료 화면에 `OM_REQUEST_PAGES_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 기존 operation-pages runtime을 open-only로 연다. 인증은 Mongo 연결보다 먼저 수행하고 operations·teamUsers·teamMembers·instructorNote·coach·omRequests와 borrowed omCustomTools를 같은 잠금 scope에서 사용한다.

실제 MongoDB 8.0.30에서 다섯 화면의 초기 데이터·권한·후보·초기값·완료 내용을 composition을 통해 확인했다. PostgreSQL 접근은 0건이었고 암호화 대상 평문은 저장 snapshot에 없었다. 조회 전후 collection 정의·validator/options·index·행 전체가 같았으며 부분 namespace도 저장 상태를 바꾸지 않고 거부했다.

OM 요청 쓰기 API selector·production 배포·운영 데이터·브라우저 전체 흐름·실제 Slack/Calendar·A/B 백업과 복원·복사·최종 전환은 미완료다.
