-- CreateEnum
CREATE TYPE "operation_status" AS ENUM ('assignment_needed', 'assignment_planned', 'active', 'done', 'retrospective_done', 'archive_needed');

-- CreateEnum
CREATE TYPE "archive_status" AS ENUM ('not_ready', 'needed', 'done');

-- CreateEnum
CREATE TYPE "education_format" AS ENUM ('offline', 'remote', 'blended', 'flipped', 'needs_review');

-- CreateEnum
CREATE TYPE "operation_channel" AS ENUM ('onsite', 'live_online', 'online_platform', 'blended', 'needs_review');

-- CreateEnum
CREATE TYPE "operation_type" AS ENUM ('lecture', 'short', 'medium', 'mid_term_long', 'mid_long', 'long', 'annual', 'always_on', 'needs_review');

-- CreateEnum
CREATE TYPE "onsite_required" AS ENUM ('Y', 'N', 'PARTIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "result_report_status" AS ENUM ('yes', 'no', 'not_required', 'needs_review');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('pending', 'completed', 'completed_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "source_team" AS ENUM ('team_1', 'team_2', 'unknown');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "operation_type" "operation_type" NOT NULL DEFAULT 'needs_review',
    "revenue" DECIMAL(14,2),
    "revenue_raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_sessions" (
    "id" UUID NOT NULL,
    "operation_id" TEXT NOT NULL,
    "course_record_id" UUID NOT NULL,
    "source_fingerprint" TEXT,
    "validation_errors" JSONB,
    "operation_status" "operation_status" NOT NULL DEFAULT 'assignment_needed',
    "archive_status" "archive_status" NOT NULL DEFAULT 'not_ready',
    "education_format" "education_format" NOT NULL DEFAULT 'needs_review',
    "education_format_raw" TEXT,
    "operation_channel" "operation_channel" NOT NULL DEFAULT 'needs_review',
    "round_no" TEXT,
    "education_days" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "operation_month" TEXT,
    "session_duration_days" INTEGER,
    "session_duration_type" "operation_type",
    "time_text" TEXT,
    "om_name" TEXT,
    "ld_name" TEXT,
    "instructors_text" TEXT,
    "coach_text" TEXT,
    "region" TEXT,
    "onsite_required" "onsite_required" NOT NULL DEFAULT 'UNKNOWN',
    "onsite_text" TEXT,
    "special_notes" TEXT,
    "operation_issue" TEXT,
    "om_update" TEXT,
    "drive_link" TEXT,
    "operation_detail" TEXT,
    "company_wiki_link" TEXT,
    "instructor_wiki_link" TEXT,
    "cost_raw" TEXT,
    "profit_raw" TEXT,
    "total_cost" DECIMAL(14,2),
    "instructor_cost" DECIMAL(14,2),
    "operation_cost" DECIMAL(14,2),
    "avg_satisfaction" TEXT,
    "instructor_satisfaction" TEXT,
    "has_result_report" "result_report_status" NOT NULL DEFAULT 'needs_review',
    "result_report_link" TEXT,
    "lecture_management_link" TEXT,
    "padlet_link" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "om_user_id" TEXT,
    "ld_user_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_import_runs" (
    "id" UUID NOT NULL,
    "source_team" "source_team" NOT NULL DEFAULT 'unknown',
    "source_type" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "workbook_name" TEXT,
    "file_name" TEXT,
    "status" "import_status" NOT NULL DEFAULT 'pending',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "imported_by" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "notes" TEXT,
    "validation_logs" JSONB,

    CONSTRAINT "data_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_source_records" (
    "id" UUID NOT NULL,
    "import_run_id" UUID NOT NULL,
    "operation_session_id" UUID,
    "source_team" "source_team" NOT NULL DEFAULT 'unknown',
    "source_workbook" TEXT NOT NULL,
    "source_sheet" TEXT NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "header_row_number" INTEGER,
    "source_fingerprint" TEXT,
    "row_snapshot" JSONB NOT NULL,
    "mapped_fields" JSONB,
    "unmapped_fields" JSONB,
    "validation_errors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_normalized_name_key" ON "companies"("normalized_name");

-- CreateIndex
CREATE INDEX "courses_course_id_idx" ON "courses"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_company_id_course_id_course_name_key" ON "courses"("company_id", "course_id", "course_name");

-- CreateIndex
CREATE UNIQUE INDEX "operation_sessions_operation_id_key" ON "operation_sessions"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "operation_sessions_source_fingerprint_key" ON "operation_sessions"("source_fingerprint");

-- CreateIndex
CREATE INDEX "operation_sessions_course_record_id_idx" ON "operation_sessions"("course_record_id");

-- CreateIndex
CREATE INDEX "operation_sessions_operation_status_idx" ON "operation_sessions"("operation_status");

-- CreateIndex
CREATE INDEX "operation_sessions_archive_status_idx" ON "operation_sessions"("archive_status");

-- CreateIndex
CREATE INDEX "operation_sessions_start_date_idx" ON "operation_sessions"("start_date");

-- CreateIndex
CREATE INDEX "operation_sessions_om_user_id_idx" ON "operation_sessions"("om_user_id");

-- CreateIndex
CREATE INDEX "operation_sessions_ld_user_id_idx" ON "operation_sessions"("ld_user_id");

-- CreateIndex
CREATE INDEX "data_import_runs_source_team_idx" ON "data_import_runs"("source_team");

-- CreateIndex
CREATE INDEX "data_import_runs_source_type_idx" ON "data_import_runs"("source_type");

-- CreateIndex
CREATE INDEX "data_import_runs_started_at_idx" ON "data_import_runs"("started_at");

-- CreateIndex
CREATE INDEX "operation_source_records_operation_session_id_idx" ON "operation_source_records"("operation_session_id");

-- CreateIndex
CREATE INDEX "operation_source_records_source_team_idx" ON "operation_source_records"("source_team");

-- CreateIndex
CREATE INDEX "operation_source_records_source_sheet_idx" ON "operation_source_records"("source_sheet");

-- CreateIndex
CREATE INDEX "operation_source_records_source_fingerprint_idx" ON "operation_source_records"("source_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "operation_source_records_import_run_id_source_sheet_source__key" ON "operation_source_records"("import_run_id", "source_sheet", "source_row_number");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_sessions" ADD CONSTRAINT "operation_sessions_course_record_id_fkey" FOREIGN KEY ("course_record_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_source_records" ADD CONSTRAINT "operation_source_records_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "data_import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_source_records" ADD CONSTRAINT "operation_source_records_operation_session_id_fkey" FOREIGN KEY ("operation_session_id") REFERENCES "operation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
