# Notion 가져오기 composition 통합 검토

총괄 `88df8a65508fe94c4b0c6d53e791a598188fb970`에서 시작했다. 제품 SHA `b0fd2e2747c4a2e4c0b4c3b7609f02ef8ea735bc`는 실제 PostgreSQL·MongoDB, 전체 회귀, typecheck/lint/build와 독립 리뷰 P0-P3 0을 통과했다.

이 통합은 Notion import 한 기능군 selector만 완료한다. 생산 배포 설정은 변경하지 않았고 기본 backend는 PostgreSQL이다. 다른 기능군 selector, 실제 Notion, 실제 데이터 이전·복원·최종 전환과 `dev → main` 조건은 미완료다.
