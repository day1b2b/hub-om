# Mongo 코치 운영 매칭 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-coach-operation-match-cli`
- 제품 커밋: `f4bbc39`
- 진단·백필 CLI는 기본 PostgreSQL과 exact `--backend=mongodb-shadow`를 지원한다.
- 명시 Mongo는 준비된 six-model shadow와 coach catalog guard만 열며 자동 준비·수리·삭제·PG fallback을 하지 않는다.
- 기존 매칭 엔진·진단 표·dry-run/`--apply`를 유지하고 조건부 연결·재실행 0·최초 guard 충돌 재시도를 검증했다.
- 일반 1,115 pass/112 skip, 실제 Mongo 1 pass, 실제 PG 연속 2회 pass, typecheck/build/lint와 독립 리뷰를 통과했다.
- 운영 실행·예약·배포·실데이터는 없으며 전체 앱 조립, 백업·복원·복사·최종 전환과 `dev → main`은 미완료다.
- 다음 작은 후보는 `db:backfill:coach-archive-service-data`의 암호화 PostgreSQL/Mongo 경계다. 실제 Notion 가져오기를 먼저 실행하는 단계가 아니다.
