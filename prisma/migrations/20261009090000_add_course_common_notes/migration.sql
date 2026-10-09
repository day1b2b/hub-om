CREATE TABLE "course_common_notes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "course_record_id" UUID NOT NULL,
  "special_notes" TEXT,
  "operation_issue" TEXT,
  "om_update" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "special_notes_pii_index" TEXT,
  "operation_issue_pii_index" TEXT,
  "om_update_pii_index" TEXT,
  "created_by_pii_index" TEXT,
  "updated_by_pii_index" TEXT,
  CONSTRAINT "course_common_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_common_notes_course_record_id_key" UNIQUE ("course_record_id"),
  CONSTRAINT "course_common_notes_course_record_id_fkey" FOREIGN KEY ("course_record_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
