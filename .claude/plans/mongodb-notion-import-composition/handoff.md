# Notion 가져오기 composition 인계

- 현재 위치: `feature/20261001-notion-import-composition`, 총괄 기준 `88df8a65508fe94c4b0c6d53e791a598188fb970`
- 생명주기: 구현·실제 DB·전체 회귀·독립 리뷰·총괄 통합 완료
- 범위: 기존 Notion import의 PostgreSQL 기본/Mongo shadow exact selector
- 검증: 실제 PostgreSQL 1 pass, 실제 Mongo 1 pass, 전체 1,174 pass/148 skip/0 fail, typecheck/build, lint 오류 0·기존 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
- 제품 SHA: `b0fd2e2747c4a2e4c0b4c3b7609f02ef8ea735bc`
- 남은 작업: 소유 합성 자원 정리 후 coverage 기준 다음 기능군 selector 선택
- 정렬 결과: `update_handoff_only`
- Do Next: 남은 실제 호출 그래프에서 독립된 기능군 selector를 같은 fail-closed 패턴으로 전환한다.
- Do Not: 운영 DB·Atlas·실제 Notion·운영 키/env·배포·dev/main을 변경하지 않는다.
- 재개 동작: `finish_current_task`
