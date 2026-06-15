CREATE TABLE "drive_import_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mode" TEXT NOT NULL DEFAULT 'dry_run',
    "status" "import_status" NOT NULL DEFAULT 'pending',
    "operation_count" INTEGER NOT NULL DEFAULT 0,
    "scanned_ref_count" INTEGER NOT NULL DEFAULT 0,
    "scan_found_folder_count" INTEGER NOT NULL DEFAULT 0,
    "scan_issue_count" INTEGER NOT NULL DEFAULT 0,
    "folder_search_count" INTEGER NOT NULL DEFAULT 0,
    "folder_search_with_candidates_count" INTEGER NOT NULL DEFAULT 0,
    "avg_satisfaction_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "instructor_satisfaction_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "instructor_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "suspicious_candidate_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "notes" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "drive_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drive_import_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "operation_session_id" UUID,
    "operation_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "input_kind" TEXT NOT NULL,
    "input_value" TEXT,
    "result_kind" TEXT NOT NULL,
    "folder_id" TEXT,
    "folder_title" TEXT,
    "folder_url" TEXT,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "key_candidates" JSONB,
    "folder_candidates" JSONB,
    "issues" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_import_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drive_import_runs_started_at_idx" ON "drive_import_runs"("started_at");
CREATE INDEX "drive_import_runs_status_idx" ON "drive_import_runs"("status");
CREATE INDEX "drive_import_results_run_id_idx" ON "drive_import_results"("run_id");
CREATE INDEX "drive_import_results_operation_session_id_idx" ON "drive_import_results"("operation_session_id");
CREATE INDEX "drive_import_results_operation_id_idx" ON "drive_import_results"("operation_id");
CREATE INDEX "drive_import_results_result_kind_idx" ON "drive_import_results"("result_kind");

ALTER TABLE "drive_import_results" ADD CONSTRAINT "drive_import_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "drive_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drive_import_results" ADD CONSTRAINT "drive_import_results_operation_session_id_fkey" FOREIGN KEY ("operation_session_id") REFERENCES "operation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
