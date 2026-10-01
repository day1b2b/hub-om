# 코치 공개 화면 composition 인계

- 생명주기: 구현·검증·독립 리뷰 완료, 총괄 통합 진행 중
- 기준 총괄: `eb015b4eb7badc01a334229e135e9fd289897d2d`
- 제품 SHA: `81c1c77e8beb35d11c4f36dd0f1e8b0c627d99c3`
- 보존 조건: 인증 선행, 기본 PostgreSQL, exact selector, 세 port의 동일 잠금 namespace, open-only 준비, 무 fallback, Next 404/redirect 보존
- 수정 금지: 요청 중 namespace 준비·수리, operation 상세의 기존 selector 중복 적용, 운영 설정·실데이터·`dev`/`main` 변경
- 다음 범위: coverage 기준 다음 미전환 기능군 selector
- 운영 이전: A/B 백업·각 복원·복사·리허설·최종 전환 전까지 미완료
