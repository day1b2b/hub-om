-- AlterTable
ALTER TABLE "coach_day_reservations" ADD COLUMN     "confirmed_engagement_id" UUID;

-- CreateIndex
CREATE INDEX "coach_day_reservations_confirmed_engagement_id_idx" ON "coach_day_reservations"("confirmed_engagement_id");

-- AddForeignKey
ALTER TABLE "coach_day_reservations" ADD CONSTRAINT "coach_day_reservations_confirmed_engagement_id_fkey" FOREIGN KEY ("confirmed_engagement_id") REFERENCES "coach_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
