# 강의 후속 알림 composition 실행 검토

- 범위: `/api/reminders/lecture-followup` GET 미리보기와 POST 발송
- 기본 PostgreSQL, 정확한 `mongodb-shadow`만 준비된 runtime open
- operations·teamUsers·requestActivity와 Slack port를 같은 잠금 scope에서 사용
- 기존 bearer/admin 권한, 원자 선점·재시도·완료 후 중복 차단 의미 유지
- 설정·부분 namespace 오류는 처리 전 고정 오류로 실패하고 fallback·자동 수리하지 않음
- 실제 Slack·Coolify 예약·운영 데이터·배포·최종 전환 제외
