CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "coaches" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_field_masters" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_curriculum_masters" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_schedules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_engagements" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_engagement_schedules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "coach_import_runs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "drive_import_runs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "drive_import_results" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
