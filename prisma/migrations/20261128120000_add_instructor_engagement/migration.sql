-- CreateEnum
CREATE TYPE "instructor_engagement_status" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "instructor_engagement_source" AS ENUM ('manual', 'contract');

-- CreateTable
CREATE TABLE "instructor_engagements" (
    "id" UUID NOT NULL,
    "source_engagement_id" TEXT NOT NULL,
    "instructor_note_id" UUID NOT NULL,
    "operation_session_id" UUID,
    "course_name" TEXT NOT NULL,
    "status" "instructor_engagement_status" NOT NULL DEFAULT 'scheduled',
    "source" "instructor_engagement_source" NOT NULL DEFAULT 'manual',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_engagement_schedules" (
    "id" UUID NOT NULL,
    "source_engagement_schedule_id" TEXT NOT NULL,
    "engagement_id" UUID NOT NULL,
    "instructor_note_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "instructor_engagement_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructor_engagements_source_engagement_id_key" ON "instructor_engagements"("source_engagement_id");

-- CreateIndex
CREATE INDEX "instructor_engagements_instructor_note_id_idx" ON "instructor_engagements"("instructor_note_id");

-- CreateIndex
CREATE INDEX "instructor_engagements_operation_session_id_idx" ON "instructor_engagements"("operation_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_engagement_schedules_source_engagement_schedule__key" ON "instructor_engagement_schedules"("source_engagement_schedule_id");

-- CreateIndex
CREATE INDEX "instructor_engagement_schedules_instructor_note_id_date_idx" ON "instructor_engagement_schedules"("instructor_note_id", "date");

-- CreateIndex
CREATE INDEX "instructor_engagement_schedules_date_idx" ON "instructor_engagement_schedules"("date");

-- AddForeignKey
ALTER TABLE "instructor_engagements" ADD CONSTRAINT "instructor_engagements_instructor_note_id_fkey" FOREIGN KEY ("instructor_note_id") REFERENCES "instructor_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_engagements" ADD CONSTRAINT "instructor_engagements_operation_session_id_fkey" FOREIGN KEY ("operation_session_id") REFERENCES "operation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_engagement_schedules" ADD CONSTRAINT "instructor_engagement_schedules_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "instructor_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_engagement_schedules" ADD CONSTRAINT "instructor_engagement_schedules_instructor_note_id_fkey" FOREIGN KEY ("instructor_note_id") REFERENCES "instructor_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activity tracking (mirror coach_engagements; schedules carry none, matching coach)
DROP TRIGGER IF EXISTS activity_change ON instructor_engagements;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON instructor_engagements
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["instructor_note_id", "operation_session_id", "course_name", "status", "source", "start_date", "end_date", "start_time", "end_time"]');
