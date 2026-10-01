# 만족도 composition 인계

- 생명주기: 구현·검증·독립 리뷰 완료, 총괄 통합 진행 중
- 기준 총괄: `2fdde543d43348f708940ab44af6904cbe9fc96a`
- 제품 SHA: `6ea2ac38d30dbd20fc950d4aa0e871b4b8e4151c`
- 보존 조건: 기본 PostgreSQL, exact selector, 세 port의 동일 잠금 namespace, open-only 준비, 무 fallback, 성공 로그의 개인정보·원천 식별자 비노출
- 수정 금지: 요청 중 namespace 준비·수리, 운영 설정·실원천·운영 데이터·`dev`/`main` 변경
- 다음 범위: coverage 기준 다음 미전환 기능군 selector
- 운영 이전: A/B 백업·각 복원·복사·리허설·최종 전환 전까지 미완료
