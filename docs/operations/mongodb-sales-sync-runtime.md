# MongoDB 매출 동기화 runtime

`/api/admin/sales-revenue`의 매출 저장 repository, 합성 Salesmap source, 실패 알림 port와 요청 감사를 하나의 명시 Mongo shadow namespace로 조립한다. 생산 기본 backend와 실제 Salesmap·Slack 연결은 유지한다.

빈 namespace만 준비하며 기존·부분 namespace는 read-only readiness에서 실패한다. 실제 MongoDB 8.0.30에서 bearer POST, 동기화 로그·요청 감사, PG·비합성 fetch 0, 재준비 mutation 0, legacy 부분 namespace의 validator·index·문서 불변, 네 포트의 누락·혼합 차단을 확인했다. 기존 금액·다중 딜·partial·재실행·알림 의미는 검증된 workflow와 repository를 그대로 사용한다.

실제 Salesmap·Slack·Coolify 예약, production selector, 운영 금액 반영, 데이터 이전·복원·최종 전환은 실행하지 않았다.
