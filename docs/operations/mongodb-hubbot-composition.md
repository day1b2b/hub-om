# Hubbot Mongo composition

2026-10-01 기준 `/api/hubbot/message`에 `HUBBOT_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 responder와 request audit를 같은 잠금 scope로 연다. 비인증 Next 리다이렉트는 보존하고 그 밖의 Mongo 오류는 고정 오류로 숨기며 fallback하지 않는다.

실제 로컬 MongoDB에서 합성 responder 응답·history·요청 감사, PostgreSQL과 외부 호출 0건, 부분 namespace 불변을 확인했다. 실제 외부 서비스·운영 selector·데이터·배포·최종 전환은 미완료다.
