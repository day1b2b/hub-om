# Validation: mongodb-snapshot-privacy

- 정책: inventory와 fields가 두 필드를 encrypted로 분류하고 companion이 nullable non-unique인지 확인한다.
- PG: schema 적용 전 legacy plaintext를 판별하고, backfill 후 암호문·정확한 HMAC·원문 응답·정렬/limit을 확인한다.
- 재실행: dry-run 불변, apply 재실행 변경0, plaintext/암호문 혼재와 missing companion 보완, 잘못된 키/암호문/non-null HMAC은 apply 전 실패하고 저장이 불변이다.
- Mongo: codec ciphertext/HMAC, validator, non-unique HMAC index, history/admin 원문 DTO와 정렬을 확인한다.
- 이전 namespace: 구 validator/plaintext 문서가 readiness를 통과하지 않으며 자동 삭제·수리하지 않는다.
- 비노출: 저장 문서·감사·오류에 합성 이름 평문0. 승인된 응답의 복호화 값은 허용한다.
- 회귀: privacy/codec/Drive writer/history/admin, 일반 test/typecheck/lint/build. 필수 skip은 PASS로 세지 않는다.
- 운영 제외: 실제 운영 migration/backfill, Drive 원천, A/B 백업·복원·배포·main/dev는 미실행이다.
