# 팀원 파일 가져오기 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-team-members-import-cli`
- 기준 총괄 SHA: `2475f2d483f38a46e0e3f6868b260004cf314789`
- 제품·검증 SHA: `209dfa44e878fb051feb74f9de49fbecaf83d09c`
- legacy raw pg import를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체했다.
- 일반 회귀 1,143 pass/128 skip, 실제 PostgreSQL·Mongo 각 1 root pass, focused 5·동결 원본 60 pass, 양쪽 CLI 프로세스, typecheck/build/lint를 확인했다.
- 운영 실행·실제 `.local` 원천·키·설정은 건드리지 않았다. `promote-source-only` 호환성, production selector, 전체 앱, 실제 백업·복원·복사·최종 전환과 `dev → main`은 미완료다.
