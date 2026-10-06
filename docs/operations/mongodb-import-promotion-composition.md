# 가져오기 승격 Mongo composition

2026-10-01 기준 `/api/admin/imports/[id]/promote`에 `IMPORT_PROMOTION_BACKEND` selector를 연결했다. 기본은 PostgreSQL이고 정확한 `mongodb-shadow`만 준비된 기존 Calendar runtime의 여덟 포트를 한 scope로 연다. `reflectOperations=false`를 유지해 승격 transaction 뒤 기존 Calendar 소급 반영만 수행하는 의미를 보존한다.

실제 로컬 MongoDB에서 준비된 runtime, 요청 감사, PG·외부 fetch 0, 부분 namespace 무수정 거부를 확인했다. 성공 승격과 합성 Calendar 결과는 기존 승격/Calendar 검증 증거를 재사용한다. 운영 승격·실제 Google·운영 DB/Atlas·키·배포는 사용하지 않았다.
