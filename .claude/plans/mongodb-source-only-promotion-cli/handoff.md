# 팀 단위 원천 승격 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-promote-source-only`
- 기준 총괄 SHA: `43b3e526bf1104f35b94f2c37bfdeb8c6f39f1a7`
- legacy source-team 전체·복수 import run 승격을 encrypted PostgreSQL/명시 prepared Mongo 경계로 전환했다.
- 일반 회귀 1,150 pass/130 skip, 실제 PostgreSQL·Mongo 각 1 root pass, focused 7, 양쪽 CLI dry-run/apply, typecheck/build/lint를 확인했다.
- 운영 실행·실원천·키·설정은 건드리지 않았다. 다음 개발 후보는 아직 raw pg인 `db:import:operations`다. production 전체 selector, 실제 백업·복원·복사·최종 전환과 `dev → main`은 미완료다.
