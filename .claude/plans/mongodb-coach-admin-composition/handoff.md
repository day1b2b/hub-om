# 코치 관리자 composition 인계

- 생명주기: 구현·검증·독립 리뷰 완료, 총괄 통합 진행 중
- 기준 총괄: `444167984c925ab596385dbff8865ee5197965c0`
- 제품 SHA: `ccb76b7bcef44684b9a17bb79bdeb6b7e70bc593`
- 검증: 단위 6 / 실제 1+1 / 전체 1,242·160·0 / 리뷰 P0-P3 0
- Do Not: 기존 soft-delete·복원·관리자 명시 영구삭제 의미 변경, 부분 namespace 자동 수리, 운영 env·dev/main 변경
- 남은 범위: 관리자 DB·관리자 유지보수 등 나머지 기능군 selector, 운영 A/B 백업·복원·복사·최종 전환
