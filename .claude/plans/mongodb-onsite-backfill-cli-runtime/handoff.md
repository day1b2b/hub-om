# Mongo 현장 투입 보정 CLI runtime 인계

- 작업 브랜치: `feature/20261001-mongodb-onsite-backfill-cli-runtime`
- 제품 커밋: `edbfe1da46b45d44dd249ae80d222d65fc0fb38c`
- 기본 PG와 legacy dry-run/`--apply`·성공 출력을 유지한다.
- raw SQL과 legacy 암호화 차단은 기존 operationBackfill repository 경계로 교체한다.
- exact Mongo selector는 준비된 shadow만 열고 schema 준비·fallback을 하지 않는다.
- 일반 1,102 pass/109 skip, actual Mongo 1 pass, focused 8 pass, typecheck/build/lint와 독립 리뷰를 통과했다.
- 운영 적용·예약·배포·실데이터는 없으며 production 전체 selector, 백업·복원·최종 전환과 dev→main은 미완료다.
