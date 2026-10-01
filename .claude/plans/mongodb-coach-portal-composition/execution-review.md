# 코치 포털 composition 실행 검토

- 범위: 코치 본인 프로필 GET, 월별 일정 GET/PUT의 기능군 selector
- 기본 경로: `COACH_PORTAL_BACKEND` 미설정 시 기존 PostgreSQL
- opt-in 경로: 정확한 `mongodb-shadow`와 유효한 shadow 좌표·분리된 암호화 키
- 유지 계약: 토큰 인증, 401/400 응답, `private, no-store`, 월 일정 전체 교체, 요청·업무 감사
- 실패 계약: 설정·준비·runtime 오류는 고정 오류로 닫고 fallback하지 않음
- 데이터 안전: 빈 namespace만 준비하며 부분 namespace는 자동 변경하지 않음
- 제외: 운영 설정·운영 데이터·실제 원천·배포·최종 cutover
