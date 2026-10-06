# Mongo 현장 투입 보정 CLI runtime 검증 v1

- 일반 회귀: 1,102 pass / 109 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 1 pass / 0 fail
- CLI/command focused: 8 pass / 0 fail
- typecheck/build: pass
- lint: 오류 0 / 기존 경고 7
- 운영 PostgreSQL·Mongo 접근: 0
- 실제 PostgreSQL 신규 실행: 미실행. 기존 operationBackfill PG repository의 격리 parity 증거를 재사용했고 새 command 경계는 scoped 실행으로 검증
- 독립 리뷰: PG 소유 연결 종료, dry-run 무쓰기, 실제 runtime 부분 namespace 불변을 보완한 뒤 잔여 P0/P1/P2 없이 수락
- 합성 replica set·DB·port: 검증 종료 후 정리

검사 묶음은 서로 겹치므로 합산하지 않는다. 실제 운영 적용과 production 전체 selector 검증으로 해석하지 않는다.
