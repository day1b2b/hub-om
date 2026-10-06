# 독립 검증 기준 v1

Anscombe 계획 critic. 설계 적합, 실행은 아직 NOT RUN.

- V1 기존 파싱/admin/DTO/null→404 및 재실행0, 기본PG 유지. processSeq·UUID 실제PG 대조. 명시scope 누락·Mongo 오류 fallback 금지.
- V2 Course/Company/활성수 동일 snapshot. 필수 관계 손상을 정상404로 숨기지 않는다.
- V3 대상 active만 deletedAt/deletedBy/updatedAt 및 필요한 암호화 companion 수정. 다른 raw 필드·삭제행·관계 불변.
- V4 실제 MongoOperationRepository의 수정·개별삭제·과정 이동·중복 과정삭제 경합. 충돌 후 재평가, 유실/부활/count·감사 중복 없음. snapshot 이후 insert·유입 포함은 보장하지 않음.
- V5 업무/변경감사 같은 transaction, 후행 실패 전체원복. context 없는 직접 호출 무감사. 요청감사 scope 누락 선행실패, 후행 요청로그 장애 성공응답 유지.
- V6 100초과/BSON짧은batch 누락없음. scan한도/timeout 부분변경없이실패. scan/transaction/retry 시간구별, timeout 주입과 실제deadline증거 구별.
- V7 고정 합성 실제PG/Mongo parity, 실제guard/withActivity/명시context 검증. 경쟁 건수 완전일치 아닌 V4 불변조건 판정.
- V8 일반test/typecheck/lint/build/영향Mongo/독립리뷰. FAIL/skip/미실행 구분. 문서·자원정리·push/SHA/통합 별도 기록.
