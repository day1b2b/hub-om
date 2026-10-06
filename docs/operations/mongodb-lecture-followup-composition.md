# 강의 후속 알림 Mongo composition

`/api/reminders/lecture-followup`의 GET 미리보기와 POST 발송에 `LECTURE_FOLLOW_UP_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 강의 후속 알림 runtime을 open-only로 연다. 운영·팀원·요청 감사 저장소와 Slack 알림 port를 같은 잠금 scope에서 사용한다.

실제 MongoDB 8.0.30 replica set에서 route export를 실행해 GET의 D+1/D+7 대상과 POST bearer 권한, 합성 Slack 발송 1회, Mongo 요청 감사를 확인했다. PostgreSQL 접근은 0건이었고 준비된 namespace 재실행과 부분 namespace 거부 전후의 collection 정의·validator/options·index·문서가 같았다. selector 설정·runtime 오류는 고정 메시지로 숨기며 PostgreSQL로 fallback하지 않는다.

기존 runtime이 검증한 동시 요청 원자 선점, 완료 후 재실행 중복 차단, 대상별 발송 실패와 완료 기록 실패 의미를 그대로 사용한다. Slack 발송과 Mongo 완료 기록은 하나의 외부 transaction이 아니므로 Slack 수락 뒤 응답 유실 시 중복 재시도 가능성은 남는다. 실제 Slack·Coolify 예약·production 배포·운영 데이터·A/B 백업과 복원·복사·최종 전환은 미완료다.
