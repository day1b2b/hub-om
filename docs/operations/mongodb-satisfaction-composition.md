# 만족도 Mongo composition

관리자 만족도 미리보기·자동 반영·수동 연결과 회차별 반영 API에 `SATISFACTION_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 만족도 runtime을 open-only로 연다. 운영 저장소·기본 Google Sheets source·요청 감사를 같은 잠금 namespace에서 사용한다.

실제 MongoDB 8.0.30에서 네 route selector를 합성 OAuth·Sheets 응답으로 실행했다. PostgreSQL 및 실제 외부 접근은 0건이고, 반영·연결·요청 감사가 같은 namespace에 저장되며 부분 namespace는 callback 전에 전체 snapshot을 변경하지 않고 거부됐다. 관리자 적용 로그는 이름·레코드 식별자 대신 고정 성공 문구만 남긴다.

실제 Google Sheets·운영 만족도 반영·production 배포 설정·운영 데이터·A/B 백업과 각 복원·복사·최종 전환은 실행하지 않았다. 생산 기본은 PostgreSQL이며 이 기능군 selector 완료를 전체 앱 전환 완료로 해석하지 않는다.
