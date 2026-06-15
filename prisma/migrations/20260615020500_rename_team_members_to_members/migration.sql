-- Rename enum
ALTER TYPE "team_member_role" RENAME TO "member_role";

-- Rename table
ALTER TABLE "team_members" RENAME TO "members";

-- Rename table constraint and indexes so database objects match the neutral name.
ALTER TABLE "members" RENAME CONSTRAINT "team_members_pkey" TO "members_pkey";
ALTER INDEX "team_members_source_team_is_active_idx" RENAME TO "members_source_team_is_active_idx";
ALTER INDEX "team_members_role_source_team_normalized_name_key" RENAME TO "members_role_source_team_normalized_name_key";
ALTER INDEX "team_members_role_source_team_is_active_idx" RENAME TO "members_role_source_team_is_active_idx";
