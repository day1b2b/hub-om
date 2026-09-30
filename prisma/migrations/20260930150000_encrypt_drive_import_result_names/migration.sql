-- Drive 결과 snapshot의 기업명·과정명은 개인 이름을 포함할 수 있으므로 HMAC companion을 추가한다.
-- 두 이름은 중복 가능하므로 companion index는 unique가 아니다.
-- 운영 적용은 Drive writer를 멈춘 maintenance에서 schema 적용 후 privacy:migrate backfill·enforce까지
-- 완료하고 검증한 뒤 재개한다. 이 migration 자체는 기존 평문을 변환하지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "drive_import_results"
  ADD COLUMN "company_name_pii_index" TEXT,
  ADD COLUMN "course_name_pii_index" TEXT;

CREATE INDEX "drive_import_results_company_name_pii_index_idx"
  ON "drive_import_results"("company_name_pii_index");
CREATE INDEX "drive_import_results_course_name_pii_index_idx"
  ON "drive_import_results"("course_name_pii_index");

COMMIT;
