# Validation v2

S1 모든 계획 Step Core/Shell/Check 태그, Core 존재 및 입력별 조건부 변환 명시.
V1 runtime codec migration roundtrip + independent malformed/golden fixtures: 누락/null/key/context/tag/money/date fail-closed, 오류 값 비노출.
V2 같은 scope 동시 요청 회차/claim 1개; 다른 fingerprint와 삭제 replay conflict.
V3 업무/counter/claim/audit rollback 및 high-water 초과 고유 sequence. 실제 replica set 결과와 단위 증거 구분.
V4 공통 synthetic DTO/정렬/lookup/summary; 최종 courseId+name+label/category/tools 원자적 수정, 관계없는 회차 보존.
V5 같은 PII 값 audit 생략, 변경 redacted, context actor 암호화, soft-delete; 검색 20,000행/32MiB 초과 오류.
V6 누락/잘못된 unique/partial/strict validator readiness 거부. 실제 server gate 미충족 시 구현/단위 검증과 서버 수락을 분리.
V7 PG factory/schema 비변경, runtime fs/Prisma DMMF 미사용, test/lint/typecheck/build 실제 결과와 skips 기록.
