# 매출 동기화 Mongo composition

`/api/admin/sales-revenue` GET/POST에 `SALES_SYNC_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 runtime을 open-only로 연다. 매출 저장소·Salesmap source·실패 notifier·팀 사용자·요청 감사를 같은 잠금 namespace에서 사용한다.

실제 MongoDB 8.0.30에서 route selector와 기본 미설정 source 경로를 실행하고, 합성 TeamUser 이메일을 Slack ID로 찾아 기본 notifier가 한 번 발송하는지 확인했다. PostgreSQL·외부 HTTP 접근은 0건이고 부분 namespace는 callback 전 전체 snapshot 불변으로 거부됐다. 실제 Salesmap·Slack·Coolify 예약·production 배포·운영 데이터·최종 전환은 미완료다.
