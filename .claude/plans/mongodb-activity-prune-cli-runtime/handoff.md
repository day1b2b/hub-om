# Mongo 활동 정리 CLI runtime 인계

- 작업 브랜치: `feature/20261001-mongodb-activity-prune-cli-runtime`
- 제품 커밋: `e642a7622281f17b5a65fff5f641f768c48b03de`
- 기본 PG와 기존 무시 인자를 유지하며 exact `--backend=mongodb-shadow`만 준비된 shadow에 연결한다.
- CLI는 schema를 준비·수리하지 않고 오류 시 PG로 fallback하지 않는다.
- 일반 회귀 1,094 pass/108 skip, 실제 Mongo 1 pass, focused 4 pass, typecheck/변경 lint 통과다.
- 운영 설정·예약·실데이터 적용은 없으며 production 전체 selector, 실백업·복원·최종 전환과 dev→main은 미완료다.
