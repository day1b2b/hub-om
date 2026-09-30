# Mongo 활동 정리 CLI runtime 검증 v1

- 일반 회귀: 1,094 pass / 108 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30: 1 pass / 0 fail
- 종료·오류 focused: 4 pass / 0 fail
- typecheck/build: pass
- 전체 lint: 오류 0 / 기존 경고 7
- PostgreSQL 운영 접근: 0
- 독립 리뷰: 종료·오류 도달 검증과 부분 namespace 불변을 보완한 뒤 잔여 P0/P1/P2 없이 최종 수락
- 합성 replica set·DB·port: 검증 종료 후 정리

최초 회귀의 7 fail은 새 backend 인자 처리 때문에 기존 무시 인자까지 거절한 호환성 회귀였다. 기존 무시 인자를 유지하고 `--backend=` 계열만 엄격하게 판정하도록 고친 뒤 최종 전체 회귀를 통과했다. 검사 묶음은 서로 겹치므로 합산하지 않는다.
