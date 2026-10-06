# OM 요청 화면 composition 실행 검토

- 범위: 등록·관리·상세·수정·완료 다섯 화면의 서버 조회
- 인증 선행, 기본 PostgreSQL, 정확한 `mongodb-shadow`만 runtime open
- 기존 operation-pages runtime과 전체 잠금 scope 재사용
- 권한·redirect·404·borrowed 맞춤 도구와 부분 namespace 불변 유지
- 쓰기 API·외부 원천·운영 데이터·배포·최종 전환 제외
