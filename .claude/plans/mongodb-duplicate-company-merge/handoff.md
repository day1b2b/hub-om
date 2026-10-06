# Mongo 중복 회사 병합 인계

- 작업 브랜치: `feature/20261001-mongodb-duplicate-company-merge`
- 기준 총괄 SHA: `ba3e4e3d28479e3080b9dce4ae67f092b5cec506`
- 제품·검증 커밋: `a74a566`
- `db:merge:duplicate-company`를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체했다.
- source 회사는 보존한다. 중복 source 과정과 라벨만 기존 유지보수 의미대로 물리 삭제하고, 회차·비중복 과정·비중복 라벨은 target 회사 쪽으로 이동한다.
- apply는 backup/maintenance gate와 단일 transaction을 사용한다. dry-run, 후반 실패 rollback, 재실행, guard 경합, 부분 namespace 무수정 거부를 합성 PostgreSQL과 실제 로컬 Mongo replica set에서 확인했다.
- 운영 실행·실데이터·원천·키·설정은 건드리지 않았다. production selector, 전체 앱, A/B 백업·각 복원·복사·최종 전환과 `dev → main`은 미완료다.
