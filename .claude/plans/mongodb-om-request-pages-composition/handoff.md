# OM 요청 화면 composition 인계

- 생명주기: 구현·검증·독립 리뷰 완료, 총괄 통합 예정
- 기준 총괄: `626c23f5b0849e0d8a391b1493c5fe9f620fcd14`
- 제품 SHA: `e7ebc67`
- Do Not: 인증 전 DB 연결, 요청 중 namespace 준비, 오류 시 PG fallback, 운영 설정·dev/main 변경
- 다음 범위: OM 요청 쓰기 API composition selector
- 운영 이전: 실데이터 복사·A/B 백업/복원·리허설·최종 전환 전까지 미완료
