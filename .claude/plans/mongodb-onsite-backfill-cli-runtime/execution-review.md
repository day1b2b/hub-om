# Mongo 현장 투입 보정 CLI runtime 실행 리뷰

기존 암호화 schema 차단 raw SQL CLI를 operationBackfill command로 교체했다. 성공 출력과 기본 dry-run/`--apply`, 소프트 삭제 제외, `onsiteRequired != Y` 대상 의미는 유지한다. 기본은 PG이며 명시 Mongo는 준비된 admin maintenance shadow만 연다.

일반 회귀 1,102 pass/109 opt-in skip/0 fail, 실제 MongoDB 8.0.30 1 pass, CLI/command focused 8 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. 실제 Mongo에서 dry-run 전체 raw snapshot 불변, apply, 재실행 0, 실제 runtime 부분 namespace의 metadata/index/document 불변과 소유 client 종료를 확인했다. 기본 PG CLI 소유 연결만 성공·실패 뒤 닫고 scoped 저장소는 유지한다. 독립 리뷰 P2 3건을 보완해 잔여 P0/P1/P2 없이 수락받았다. 운영 DB·설정·데이터에는 접근하지 않았다.
