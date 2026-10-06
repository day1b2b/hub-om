-- CreateEnum
CREATE TYPE "team_member_role" AS ENUM ('om', 'ld');

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN "role" "team_member_role";

-- DropIndex
DROP INDEX "team_members_source_team_normalized_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "team_members_role_source_team_normalized_name_key" ON "team_members"("role", "source_team", "normalized_name");

-- CreateIndex
CREATE INDEX "team_members_role_source_team_is_active_idx" ON "team_members"("role", "source_team", "is_active");
