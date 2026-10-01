# 운영 쓰기 composition 실행 검토

- 범위: 운영 생성·회차 추가·순서 변경·삭제 API
- 기본 PostgreSQL, exact Mongo selector, 준비된 namespace open-only
- Calendar reflecting repository·lock·persistence·request audit 동일 scope
- 실제 합성 Calendar, PG/비합성 외부 접근 차단, 부분 namespace 불변
- 실제 Google·운영 데이터·배포·cutover 제외
