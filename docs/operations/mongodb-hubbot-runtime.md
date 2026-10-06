# MongoDB Hubbot runtime

`/api/hubbot/message`의 응답 port와 요청 감사를 하나의 명시 Mongo shadow scope로 조립한다. 생산 기본 responder는 기존 `askHubBot`을 그대로 사용해 Anthropic·Google Sheets·Notion 동작을 유지한다.

실제 MongoDB 8.0.30에서 인증된 POST의 질문 trim·history 필터·합성 응답·요청 감사, PG·비합성 fetch 0, 재준비 mutation 0, 부분 namespace 불변, 두 포트 누락·혼입 차단을 확인했다. 질문과 대화 내용은 Mongo 감사에 저장하지 않는다.

실제 Anthropic·Google·Notion, production selector, 데이터 이전·복원·최종 전환은 실행하지 않았다.
