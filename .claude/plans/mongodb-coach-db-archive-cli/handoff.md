# 코치 DB 아카이브 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-coach-db-archive-cli`
- 기준 총괄 SHA: `7ec8c4385e25d6e4274aefadd1c152675095ecc2`
- 제품·검증 SHA: `09fca63`
- source는 PostgreSQL read-only snapshot, target은 encrypted PostgreSQL 기본/명시 prepared Mongo다.
- dry-run 무쓰기, apply 전체 transaction, 반복 새 snapshot, 중복 키 전체 rollback, 암호문/HMAC과 고정 오류를 검증한다.
- 일반 1,134 pass/123 skip, 실제 PG·Mongo, typecheck/build/lint를 통과했고 독립 최종 리뷰에서 잔여 P0–P3가 없다.
- 원격 통합 상태는 integration-review를 따른다.
- 실제 백업·복원·실데이터 복사·production selector·최종 전환과 `dev → main`은 미완료다.
