-- CreateEnum
CREATE TYPE "CoachContentEntryKind" AS ENUM ('NOTE', 'EDIT_HISTORY');

-- CreateTable
CREATE TABLE "coach_content_entries" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "kind" "CoachContentEntryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "author_email" TEXT,
    "author_name" TEXT,
    "source_field" TEXT,
    "flagged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "coach_content_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_content_entries_coach_id_idx" ON "coach_content_entries"("coach_id");

-- CreateIndex
CREATE INDEX "coach_content_entries_kind_idx" ON "coach_content_entries"("kind");

-- AddForeignKey
ALTER TABLE "coach_content_entries" ADD CONSTRAINT "coach_content_entries_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
