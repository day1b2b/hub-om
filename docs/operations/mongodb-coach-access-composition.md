# 코치 접근 정보 API Mongo composition

2026-10-01 기준 코치 토큰 재발급과 개인정보 CSV 내보내기를 `COACH_ACCESS_BACKEND` selector에 연결했다. 기본 PostgreSQL을 유지하며 명시 Mongo에서 token rotation·export·request audit를 같은 잠금 scope로 연다. 승인된 응답에는 새 토큰과 요청한 개인정보를 복호화해 제공하되 Mongo 저장에는 원문이 남지 않는다. 실제 Mongo에서 권한·세 감사·롤백·부분 namespace 불변을 확인했다. 운영 이전은 미완료다.
