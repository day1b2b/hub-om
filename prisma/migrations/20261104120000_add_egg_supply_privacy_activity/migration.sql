-- 에그·운영물품 대여 테이블을 dev의 개인정보 암호화·활동 이력 규칙에 맞춘다.
-- 이름·이메일·메모·처리자·WiFi 비밀번호는 앱에서 암호화하고, 검색용 blind index 칸을 둔다.

ALTER TABLE "egg_devices"
  ADD COLUMN "wifi_password_pii_index" TEXT,
  ADD COLUMN "caution_note_pii_index" TEXT,
  ADD COLUMN "data_exhausted_by_pii_index" TEXT,
  ADD COLUMN "deleted_by_pii_index" TEXT;

ALTER TABLE "egg_rentals"
  ADD COLUMN "borrower_name_pii_index" TEXT,
  ADD COLUMN "borrower_email_pii_index" TEXT,
  ADD COLUMN "actual_use_note_pii_index" TEXT,
  ADD COLUMN "note_pii_index" TEXT,
  ADD COLUMN "returned_by_pii_index" TEXT,
  ADD COLUMN "created_by_pii_index" TEXT,
  ADD COLUMN "deleted_by_pii_index" TEXT;

ALTER TABLE "egg_guides"
  ADD COLUMN "content_pii_index" TEXT,
  ADD COLUMN "updated_by_pii_index" TEXT;

ALTER TABLE "supply_items"
  ADD COLUMN "note_pii_index" TEXT,
  ADD COLUMN "deleted_by_pii_index" TEXT;

ALTER TABLE "supply_rentals"
  ADD COLUMN "borrower_name_pii_index" TEXT,
  ADD COLUMN "borrower_email_pii_index" TEXT,
  ADD COLUMN "note_pii_index" TEXT,
  ADD COLUMN "returned_by_pii_index" TEXT,
  ADD COLUMN "created_by_pii_index" TEXT,
  ADD COLUMN "deleted_by_pii_index" TEXT;


-- 암호화 칸은 감사 기록 값 목록에서 뺀다(activity/field-policy.json과 같게).
DROP TRIGGER IF EXISTS activity_change ON egg_devices;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON egg_devices
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["part", "number", "label", "model_code", "charger_type", "speed_mbps", "storage_location", "monthly_data_gb", "contract_ends_on", "data_exhausted", "data_exhausted_at", "deleted_at"]');
DROP TRIGGER IF EXISTS activity_change ON egg_rentals;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON egg_rentals
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["egg_device_id", "course_name", "start_date", "return_due_date", "returned_at", "deleted_at"]');
DROP TRIGGER IF EXISTS activity_change ON egg_guides;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON egg_guides
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["part"]');
DROP TRIGGER IF EXISTS activity_change ON supply_items;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON supply_items
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["category", "label", "components", "storage_location", "sort_order", "deleted_at"]');
DROP TRIGGER IF EXISTS activity_change ON supply_rentals;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON supply_rentals
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["category", "course_name", "start_date", "return_due_date", "returned_at", "deleted_at"]');
