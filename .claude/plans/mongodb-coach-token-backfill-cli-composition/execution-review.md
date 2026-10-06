# 코치 토큰 보완 CLI composition 실행 리뷰

- 범위: `db:backfill:coach-access-tokens`
- 선택: PostgreSQL 기본, exact `--backend=mongodb-shadow`에서 open-only Mongo runtime
- 실제 Mongo 확인: dry-run·apply·재실행, 암호화 저장, PG 환경 미로딩, 부분 namespace 불변
- 집중 검증: 단위/명령 11건, 실제 Mongo CLI 4건 통과
- 전체 회귀: 1543개 중 1368 pass·175 skip·0 fail, typecheck·build 통과, lint 오류 0·기존 경고 7
- 독립 리뷰: P0 0건, P1 0건, P2 0건, P3 0건. 통합 가능.
- 미완료: 운영 백업/maintenance·실제 적용
