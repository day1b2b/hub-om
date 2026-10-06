# 코치 동기화 예약 작업 composition 실행 검토

- 범위: Notion·계약·일정·전체 동기화 네 API의 GET/POST
- 기본 PostgreSQL, 정확한 `mongodb-shadow`만 준비된 runtime open
- 두 저장 repository·두 source port·실행 로그·요청 감사를 같은 잠금 namespace에서 사용
- 실제 route selector와 기본 source adapter를 합성 Notion·Google HTTP로 검증
- 설정·부분 namespace 오류는 처리·source 접근 전에 실패하고 fallback·자동 수리하지 않음
- 실제 원천·Coolify 예약·운영 데이터·배포·최종 전환 제외
