# Mongo 관리자 유지보수 runtime 검증 v1

- 일반 회귀: 1,090 pass / 105 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 1 pass / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P0/P1/P2 없음
- PostgreSQL 접근: 0
- 합성 replica set·DB·port: 종료 후 정리

첫 실행은 테스트 로더의 `next/navigation` 확장자 매핑 누락으로 제품 실행 전에 실패했다. 기존 패턴대로 매핑 후 새 합성 DB에서 전체 실제 흐름을 통과했다. 운영·브라우저 전체 흐름·production selector·실제 이전은 미검증이다.
