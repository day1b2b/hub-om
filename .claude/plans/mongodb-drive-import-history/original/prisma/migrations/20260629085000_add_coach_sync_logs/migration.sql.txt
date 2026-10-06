CREATE TABLE "coach_sync_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "error_detail" TEXT,
  "triggered_by" TEXT NOT NULL,
  "started_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" timestamp(3)
);

CREATE INDEX "coach_sync_logs_type_started_at_idx"
  ON "coach_sync_logs"("type", "started_at");
