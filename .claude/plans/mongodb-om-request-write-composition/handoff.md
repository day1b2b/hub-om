# OM 요청 쓰기 composition 인계

- 생명주기: 구현·검증·독립 리뷰·총괄 통합 완료
- 기준 총괄: `1d50220493e8a877e1d313e1461edc90b74290e2`
- 제품 SHA: `2321e67`
- Do Not: 요청 중 namespace 준비, 오류 시 PG fallback, effect 실패로 core 저장 rollback, 운영 설정·dev/main 변경
- 다음 범위: coverage 기준 다음 미전환 기능군 selector
- 운영 이전: 실데이터 복사·A/B 백업/복원·리허설·최종 전환 전까지 미완료
- 총괄 통합 확인 SHA: `5c05954` (완료 표시 직전)
