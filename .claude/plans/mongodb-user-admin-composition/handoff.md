# 사용자 관리 composition 인계

- 생명주기: 구현·검증·독립 리뷰 완료, 총괄 통합 진행 중
- 기준 총괄: `2e8a003f66930ee3b2a906ab1b63b686eb117ccc`
- 제품 SHA: `84c263aeec261e7d0b4a5d474b66c05464a8999d`
- 검증: 단위 6 / 실제 1+1 / 전체 1,260·163·0 / 리뷰 P0-P3 0
- Do Not: 사용자 영구삭제 임의 구현, lookup DTO 확장, 부분 namespace 자동 수리, 운영 env·dev/main 변경
- 남은 범위: 코치 포털 등 나머지 기능군 selector, 사용자 삭제 정책 결정, 운영 A/B 백업·복원·복사·최종 전환
