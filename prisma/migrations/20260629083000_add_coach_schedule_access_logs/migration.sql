CREATE TABLE "coach_schedule_access_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_access_log_id" TEXT,
  "coach_id" uuid NOT NULL,
  "year_month" TEXT NOT NULL,
  "accessed_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_edited_at" timestamp(3),
  CONSTRAINT "coach_schedule_access_logs_coach_id_fkey"
    FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "coach_schedule_access_logs_source_access_log_id_key"
  ON "coach_schedule_access_logs"("source_access_log_id");

CREATE UNIQUE INDEX "coach_schedule_access_logs_coach_id_year_month_key"
  ON "coach_schedule_access_logs"("coach_id", "year_month");

CREATE INDEX "coach_schedule_access_logs_year_month_idx"
  ON "coach_schedule_access_logs"("year_month");
