-- 20260723062051_add_coach_day_reservation에서 Prisma가 drift로 판단해 삭제한
-- coach-db 보관용 테이블 2개를 복원한다 (원본 DDL: 20260629070000_add_coachdb_archive_tables).
-- 데이터는 scripts/archive-coach-db.ts를 다시 실행해 원본 coach-db에서 재적재한다.
-- IF NOT EXISTS를 사용해 어느 환경에서든 안전하게 재실행 가능하다.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "coachdb_archive_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_database" text NOT NULL,
  "source_schema" text NOT NULL DEFAULT 'public',
  "table_count" integer NOT NULL DEFAULT 0,
  "row_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'running',
  "error_message" text,
  "started_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" timestamp(3)
);

CREATE TABLE IF NOT EXISTS "coachdb_archive_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "snapshot_id" uuid NOT NULL REFERENCES "coachdb_archive_snapshots"("id") ON DELETE CASCADE,
  "table_schema" text NOT NULL,
  "table_name" text NOT NULL,
  "row_key" text NOT NULL,
  "row_data" jsonb NOT NULL,
  "archived_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coachdb_archive_rows_snapshot_table_key_unique"
    UNIQUE ("snapshot_id", "table_schema", "table_name", "row_key")
);

CREATE INDEX IF NOT EXISTS "coachdb_archive_rows_table_idx"
  ON "coachdb_archive_rows" ("table_schema", "table_name");

CREATE INDEX IF NOT EXISTS "coachdb_archive_rows_snapshot_idx"
  ON "coachdb_archive_rows" ("snapshot_id");

CREATE INDEX IF NOT EXISTS "coachdb_archive_rows_data_gin_idx"
  ON "coachdb_archive_rows" USING gin ("row_data");
