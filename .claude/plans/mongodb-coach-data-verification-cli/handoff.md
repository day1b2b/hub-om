# 코치 데이터 검증 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-coach-data-verify-cli`
- 기준 총괄 SHA: `4eb953a011e9411c337d91a9c4d03fd03e8d0f89`
- 제품·검증 SHA: `d1af2a5`
- legacy raw pg 검증을 기본 encrypted PostgreSQL과 exact prepared Mongo shadow 읽기 repository로 교체했다.
- 서비스/최근 import/최근 아카이브/아카이브 주요 테이블을 한 snapshot에서 세고 개인정보 값은 출력하지 않는다.
- 선택적 `COACH_DB_DATABASE_URL`은 session과 transaction 모두 read-only이며 target도 쓰기 불가 transaction이다.
- 일반 1,131 pass/121 skip, 실제 PG·Mongo·동일 fixture parity, typecheck/build/lint를 통과했고 독립 최종 리뷰에서 잔여 P0–P3가 없다.
- 운영 DB·Atlas·실제 원천·키·설정은 건드리지 않았다. archive/import 전환, production selector, 실제 복사·백업·복원·최종 전환과 `dev → main`은 미완료다.
