# Google Sheets 가져오기 composition 인계

- 현재 위치: `feature/20261001-google-sheets-import-composition`, 총괄 기준 `422ead6c2339967466b9a7b52bac0c48e3e1119f`
- 생명주기: 구현·실제 DB·전체 회귀·독립 리뷰·총괄 통합 완료
- 범위: 기존 Google Sheets tabs/import의 PostgreSQL 기본/Mongo shadow exact selector
- 검증: 단위 5 pass, 실제 Mongo 1 pass, 전체 일반 1,179 pass/149 skip/0 fail, Mongo 활성 전체 1,180 pass/148 skip/0 fail, typecheck/build, lint 오류 0·기존 7
- 독립 리뷰: P0 0 / P1 0 / P2 0 / P3 0
- 제품 SHA: `ab80e6cd6f34a0e406bb15c8669a3f80b2c4b289`
- 총괄 통합 SHA: `4e25406ec48633d70f65f6582eb5f5ee40a3d6bf`
- 남은 작업: 소유 합성 자원 정리 후 coverage 기준 다음 기능군 selector 선택
- 정렬 결과: `update_handoff_only`
- Do Next: 현재 단위의 검토·통합을 완료한 뒤 coverage에서 다음 기능군 selector를 선택한다.
- Do Not: 운영 DB·Atlas·실제 Google·운영 키/env·배포·dev/main을 변경하지 않는다.
- 재개 동작: `select_next_unit`
