-- CreateTable
CREATE TABLE "om_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL,
    "assigned_om" TEXT,
    "ld_email" TEXT,
    "slack_channel" TEXT,
    "slack_thread_ts" TEXT,
    "team" TEXT NOT NULL,
    "ld" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "business_number" TEXT,
    "training_type" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "course_category_major" TEXT,
    "course_category" TEXT NOT NULL,
    "tools" TEXT,
    "instructor_name" TEXT NOT NULL,
    "syncup_link" TEXT NOT NULL,
    "drive_link" TEXT NOT NULL,
    "skillflo_setup" TEXT NOT NULL,
    "skillmatch_setup" TEXT NOT NULL,
    "onsite_operation" TEXT NOT NULL,
    "coach_request" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "sessions" JSONB NOT NULL,
    "notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "om_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "om_requests_created_at_idx" ON "om_requests"("created_at");
