-- 기업위키 사업자등록증 정보(계산서 발행 요청 연계) 기능을 위해 companies에 컬럼을 추가한다.
-- 전부 nullable, 기본값 없음, 기존 row는 전혀 바뀌지 않는다(백필 없음).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "companies"
  ADD COLUMN "business_number" TEXT,
  ADD COLUMN "representative_name" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "business_type" TEXT,
  ADD COLUMN "business_item" TEXT,
  ADD COLUMN "invoice_email" TEXT,
  ADD COLUMN "invoice_email_secondary" TEXT,
  ADD COLUMN "business_info_updated_at" TIMESTAMP(3),
  ADD COLUMN "business_info_updated_by" TEXT,
  ADD COLUMN "business_number_pii_index" TEXT,
  ADD COLUMN "representative_name_pii_index" TEXT,
  ADD COLUMN "address_pii_index" TEXT,
  ADD COLUMN "invoice_email_pii_index" TEXT,
  ADD COLUMN "invoice_email_secondary_pii_index" TEXT;

-- 사업자등록번호로 동일 사업자를 찾는 조회(중복 기업 감지 등)를 위한 인덱스.
CREATE INDEX "companies_business_number_pii_index_idx"
  ON "companies"("business_number_pii_index");

COMMIT;
