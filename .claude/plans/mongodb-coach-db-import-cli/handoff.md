# 코치 DB 가져오기 CLI 인계

- 작업 브랜치: `feature/20261001-mongodb-coach-import-cli`
- 기준 총괄 SHA: `42cbdcc032c230f7ab9f0ebbaeb2e51b4f57d320`
- 제품·검증 SHA: `39a83a906570affd5aba7b286a7c97e41a08e776`
- source는 PostgreSQL read-only repeatable snapshot, target은 encrypted PostgreSQL 기본/명시 prepared Mongo다.
- dry-run 무쓰기, apply 전체 transaction, 재실행, 수동 필드·기존 태그 보존, 누락 부모 오류 집계, 암호문/HMAC, 후반 고유성 실패 rollback을 검증했다.
- 일반 1,138 pass/126 skip, 실제 source PG·target PG·Mongo, UTC·서울·미국 서부 시간대, typecheck/build를 통과했다.
- 경쟁 충돌 강제 barrier, source 조회 사이 변경 barrier, 실제 script process entry는 추가 검증 대상으로 남아 있으며 PASS로 처리하지 않았다.
- 독립 최종 리뷰에서 잔여 P0–P3가 없었다. 원격 통합 상태는 integration-review에 기록한다.
- 실제 원천·운영 실행·백업·복원·실데이터 복사·production selector·최종 전환과 `dev → main`은 미완료다.
