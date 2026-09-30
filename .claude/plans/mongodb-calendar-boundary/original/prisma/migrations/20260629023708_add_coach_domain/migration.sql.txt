-- CreateEnum
CREATE TYPE "coach_status" AS ENUM ('pending', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "coach_engagement_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "coach_engagement_source" AS ENUM ('sheet', 'manual');

-- AlterTable
ALTER TABLE "drive_import_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "drive_import_runs" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "coaches" (
    "id" UUID NOT NULL,
    "source_coach_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "work_type" TEXT,
    "status" "coach_status" NOT NULL DEFAULT 'active',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_private_profiles" (
    "coach_id" UUID NOT NULL,
    "employee_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" DATE,
    "affiliation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_private_profiles_pkey" PRIMARY KEY ("coach_id")
);

-- CreateTable
CREATE TABLE "coach_field_masters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "coach_field_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_curriculum_masters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "coach_curriculum_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_fields" (
    "coach_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "coach_fields_pkey" PRIMARY KEY ("coach_id","tag_id")
);

-- CreateTable
CREATE TABLE "coach_curriculums" (
    "coach_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "coach_curriculums_pkey" PRIMARY KEY ("coach_id","tag_id")
);

-- CreateTable
CREATE TABLE "coach_schedules" (
    "id" UUID NOT NULL,
    "source_schedule_id" TEXT NOT NULL,
    "coach_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_engagements" (
    "id" UUID NOT NULL,
    "source_engagement_id" TEXT NOT NULL,
    "coach_id" UUID NOT NULL,
    "operation_session_id" UUID,
    "course_name" TEXT NOT NULL,
    "status" "coach_engagement_status" NOT NULL DEFAULT 'scheduled',
    "source" "coach_engagement_source" NOT NULL DEFAULT 'manual',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "rating" SMALLINT,
    "rehire" BOOLEAN,
    "feedback" TEXT,
    "hired_by_id" TEXT,
    "hired_by_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_engagement_schedules" (
    "id" UUID NOT NULL,
    "source_engagement_schedule_id" TEXT NOT NULL,
    "engagement_id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "coach_engagement_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_import_runs" (
    "id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'dry_run',
    "status" "import_status" NOT NULL DEFAULT 'pending',
    "coach_count" INTEGER NOT NULL DEFAULT 0,
    "engagement_count" INTEGER NOT NULL DEFAULT 0,
    "schedule_count" INTEGER NOT NULL DEFAULT 0,
    "matched_operation_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "notes" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "coach_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coaches_source_coach_id_key" ON "coaches"("source_coach_id");

-- CreateIndex
CREATE INDEX "coaches_normalized_name_idx" ON "coaches"("normalized_name");

-- CreateIndex
CREATE INDEX "coaches_status_is_active_idx" ON "coaches"("status", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "coach_field_masters_name_key" ON "coach_field_masters"("name");

-- CreateIndex
CREATE UNIQUE INDEX "coach_curriculum_masters_name_key" ON "coach_curriculum_masters"("name");

-- CreateIndex
CREATE UNIQUE INDEX "coach_schedules_source_schedule_id_key" ON "coach_schedules"("source_schedule_id");

-- CreateIndex
CREATE INDEX "coach_schedules_coach_id_date_idx" ON "coach_schedules"("coach_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "coach_engagements_source_engagement_id_key" ON "coach_engagements"("source_engagement_id");

-- CreateIndex
CREATE INDEX "coach_engagements_coach_id_idx" ON "coach_engagements"("coach_id");

-- CreateIndex
CREATE INDEX "coach_engagements_operation_session_id_idx" ON "coach_engagements"("operation_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "coach_engagement_schedules_source_engagement_schedule_id_key" ON "coach_engagement_schedules"("source_engagement_schedule_id");

-- CreateIndex
CREATE INDEX "coach_engagement_schedules_coach_id_date_idx" ON "coach_engagement_schedules"("coach_id", "date");

-- CreateIndex
CREATE INDEX "coach_engagement_schedules_date_idx" ON "coach_engagement_schedules"("date");

-- CreateIndex
CREATE INDEX "coach_import_runs_started_at_idx" ON "coach_import_runs"("started_at");

-- AddForeignKey
ALTER TABLE "coach_private_profiles" ADD CONSTRAINT "coach_private_profiles_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_fields" ADD CONSTRAINT "coach_fields_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_fields" ADD CONSTRAINT "coach_fields_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "coach_field_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_curriculums" ADD CONSTRAINT "coach_curriculums_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_curriculums" ADD CONSTRAINT "coach_curriculums_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "coach_curriculum_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_schedules" ADD CONSTRAINT "coach_schedules_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_engagements" ADD CONSTRAINT "coach_engagements_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_engagements" ADD CONSTRAINT "coach_engagements_operation_session_id_fkey" FOREIGN KEY ("operation_session_id") REFERENCES "operation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_engagement_schedules" ADD CONSTRAINT "coach_engagement_schedules_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "coach_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_engagement_schedules" ADD CONSTRAINT "coach_engagement_schedules_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
