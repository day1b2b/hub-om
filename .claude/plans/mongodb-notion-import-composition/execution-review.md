# Notion 가져오기 composition 실행 리뷰

- 기준 총괄 SHA: `88df8a65508fe94c4b0c6d53e791a598188fb970`
- 작업 브랜치: `feature/20261001-notion-import-composition`
- 범위: 기존 Notion import의 PostgreSQL 기본/Mongo shadow 명시 선택과 다섯 포트 단일 scope
- 실제 PostgreSQL 17: 1 pass / 0 skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 pass / 0 skip / 0 fail
- 전체 테스트: 1,174 pass / 148 skip / 0 fail
- typecheck/build: 통과
- lint: 오류 0 / 기존 경고 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
- 제품 SHA: `b0fd2e2747c4a2e4c0b4c3b7609f02ef8ea735bc`

기존 reader·parser·staging·권한·오류 계약은 재구현하지 않았다. 공통 shadow 선검증은 source-read selector의 검증을 모듈로 이동해 두 기능군이 같은 canonical key/좌표 규칙을 사용한다. 실제 운영 환경·원천·키는 사용하지 않았다.
