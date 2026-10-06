# 원천 읽기 상태 composition 통합 검토

총괄 `10e5852c6fcf5b2b40c5ce3f0c9e0e58ed8c9125`에서 시작했다. 제품 변경은 실제 PostgreSQL·MongoDB, 전체 회귀, typecheck/lint/build와 독립 리뷰를 통과한 뒤 총괄에 fast-forward 통합한다.

이 통합은 원천 읽기 상태 API 한 기능군의 selector만 완료한다. 생산 배포 설정은 변경하지 않았고 기본 backend는 PostgreSQL이다. 다른 기능군 selector, 실제 데이터 이전·복원·최종 전환과 `dev → main` 조건은 미완료다.

- 제품 SHA: `1633976f22e2c1cae13e43faea71748bf1173802`
- 전체 회귀: 1,169 pass / 146 skip / 0 fail
- 실제 DB: PostgreSQL 17 1 pass, MongoDB 8.0.30 replica set 1 pass
- typecheck/build: 통과
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
