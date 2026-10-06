# Mongo 코치 아카이브 서비스 백필 인계

- 작업 브랜치: `feature/20261001-mongodb-coach-archive-service-backfill`
- 제품·검증 커밋: `90e0cc81f7dfbbd62c4754e1b455253cf27a668b`
- legacy raw SQL CLI를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체했다.
- apply는 `--backup-confirmed --maintenance-confirmed`를 요구하며 플래그가 실제 백업·쓰기 중단을 대신하지 않는다.
- 최신 completed archive, 코치 변경 필드, 접속 로그 upsert, rollback·재실행·11000 재시도·오류 비노출을 검증했다.
- 일반 1,121 pass/114 skip, 실제 Mongo root 1, 실제 PostgreSQL 1, focused 6, typecheck/build/lint를 통과했다.
- 운영 실행·실데이터·원천·키·설정은 건드리지 않았다. production selector, 전체 앱, A/B 백업·각 복원·복사·최종 전환과 `dev → main`은 미완료다.
- 다음 개발 후보는 남은 write CLI인 `db:merge:duplicate-company`의 정책·repository 경계 조사다.
