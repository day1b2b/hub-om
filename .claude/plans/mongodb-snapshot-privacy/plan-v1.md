# Plan: mongodb-snapshot-privacy

1. **[Core] 정책·스키마** — inventory/fields, Prisma companion columns, SQL migration, Mongo runtime contract를 함께 갱신한다.
2. **[Shell] 저장·조회 의미** — 공통 암호화 wrapper/codec으로 writer·history·admin 경계를 유지한다. 별도 raw equality는 없고 정렬은 복호화 후 수행한다.
3. **[Check] 전환 검증** — legacy plaintext, 새 암호문, partial backfill, 재실행, 키 불일치, HMAC 변조, PG/Mongo 정렬·limit·응답 원문을 검증한다.
4. **[Check] namespace·운영 순서** — 이전 Mongo 정책 거부와 새 namespace 재복사, PG maintenance→schema→backfill→enforce→재개 및 rollback을 문서화한다.
5. **[Check] 회귀·독립 리뷰·통합** — 관련/전체 검사 후 작업 브랜치와 총괄 브랜치에만 commit/push한다.

새 의존성·업무 필드·삭제 정책은 추가하지 않는다. companion은 암호화 저장 무결성과 기존 String 정책 일관성을 위한 기술 필드다.
