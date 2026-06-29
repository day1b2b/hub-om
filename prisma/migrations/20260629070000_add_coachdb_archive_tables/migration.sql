CREATE TABLE "coachdb_archive_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "source_database" text NOT NULL,
  "source_schema" text NOT NULL DEFAULT 'public',
  "table_count" integer NOT NULL DEFAULT 0,
  "row_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'running',
  "error_message" text,
  "started_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" timestamp(3)
);

CREATE TABLE "coachdb_archive_rows" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "snapshot_id" uuid NOT NULL REFERENCES "coachdb_archive_snapshots"("id") ON DELETE CASCADE,
  "table_schema" text NOT NULL,
  "table_name" text NOT NULL,
  "row_key" text NOT NULL,
  "row_data" jsonb NOT NULL,
  "archived_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coachdb_archive_rows_snapshot_table_key_unique"
    UNIQUE ("snapshot_id", "table_schema", "table_name", "row_key")
);

CREATE INDEX "coachdb_archive_rows_table_idx"
  ON "coachdb_archive_rows" ("table_schema", "table_name");

CREATE INDEX "coachdb_archive_rows_snapshot_idx"
  ON "coachdb_archive_rows" ("snapshot_id");

CREATE INDEX "coachdb_archive_rows_data_gin_idx"
  ON "coachdb_archive_rows" USING gin ("row_data");
