# 운영 화면 composition 실행 검토

- 범위: 운영 목록·상세·신규 화면의 초기 서버 조회
- 기본 PostgreSQL, 정확한 `mongodb-shadow`만 준비된 runtime open
- 일곱 repository/borrowed port를 같은 잠금 scope로 사용
- Mongo 선택에서 PostgreSQL 및 legacy local JSON fallback 차단
- 부분 namespace 자동 수리 금지, redirect·404 보존
- 운영 데이터·배포·쓰기 API·최종 전환 제외
