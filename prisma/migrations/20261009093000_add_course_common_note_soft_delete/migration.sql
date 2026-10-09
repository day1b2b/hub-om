-- 공통 메모는 복구 가능해야 한다. 기존 회차별 메모와 이관 데이터는 건드리지 않는다.
ALTER TABLE "course_common_notes"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" TEXT,
  ADD COLUMN "deleted_by_pii_index" TEXT;

CREATE INDEX "course_common_notes_deleted_at_idx" ON "course_common_notes"("deleted_at");
