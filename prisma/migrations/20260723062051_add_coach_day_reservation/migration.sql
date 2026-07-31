/*
  Warnings:

  - You are about to drop the `coachdb_archive_rows` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `coachdb_archive_snapshots` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "coachdb_archive_rows" DROP CONSTRAINT "coachdb_archive_rows_snapshot_id_fkey";

-- AlterTable
ALTER TABLE "coach_curriculum_masters" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_engagement_schedules" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_engagements" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_field_masters" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_import_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_private_profiles" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_schedule_access_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_schedules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coach_sync_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coaches" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "drive_import_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "drive_import_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "team_users" ALTER COLUMN "id" DROP DEFAULT;

-- DropTable
DROP TABLE "coachdb_archive_rows";

-- DropTable
DROP TABLE "coachdb_archive_snapshots";

-- CreateTable
CREATE TABLE "coach_day_reservations" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reserved_by_email" TEXT NOT NULL,
    "reserved_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "coach_day_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_day_reservations_coach_id_date_idx" ON "coach_day_reservations"("coach_id", "date");

-- AddForeignKey
ALTER TABLE "coach_day_reservations" ADD CONSTRAINT "coach_day_reservations_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
