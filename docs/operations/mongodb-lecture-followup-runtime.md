# MongoDB 강의 후속 알림 runtime

`/api/reminders/lecture-followup`의 운영 회차, 팀 사용자, 요청 감사를 하나의 명시 Mongo shadow namespace로 조립한다. Slack DM은 명시 port로 분리하고, shadow runtime의 발송 기록은 namespace 내부 원자 선점 collection에 둔다. context 밖의 생산 기본 backend와 기존 로컬 파일·Slack 구현은 그대로 유지한다.

`prepareMongoLectureFollowUpRuntime`은 완전히 빈 namespace만 준비한다. 일부 collection이나 알 수 없는 legacy collection이 있으면 자동 생성·수리·삭제하지 않고 read-only readiness에서 실패한다. 등록한 다섯 port는 실행 중 잠가 다른 namespace나 누락 port를 섞지 못하게 한다.

로컬 MongoDB 8.0.30 replica set에서 실제 GET 미리보기와 bearer POST를 실행했다. D+1·D+7 두 회차를 한 DM으로 묶고 성공한 키 두 개를 기록한 뒤, 완료 후 재실행에서는 발송하지 않는지 확인했다. 발송 실패는 키를 기록하지 않았고 notifier·로그 오류 원문은 API·로그에 남지 않았다. 모든 요청 감사와 저장 개인정보 암호화, PostgreSQL·실제 fetch·로컬 파일 접근 0도 확인했다.

shadow runtime은 HMAC 발송 키를 Mongo transaction으로 먼저 선점해 동시 요청 중 하나만 DM 발송권을 얻는다. 전송 실패·예외는 선점을 해제하고 다른 수신자를 계속 처리한다. Slack 성공 뒤 Mongo 완료 기록만 실패한 경우에는 선점을 유지해 재시도 중복을 막는다. 다만 Slack이 메시지를 수락한 뒤 응답이 유실되면 notifier 예외로 취급해 선점을 해제하므로 재시도 중복 가능성이 남는다. 외부 Slack과 Mongo를 하나의 transaction으로 묶는 exactly-once 경계는 아니다. 실제 Slack, Coolify 예약 설정, production selector, 운영 데이터 이전·복원·최종 전환은 실행하지 않았다.
