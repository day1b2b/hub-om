-- AlterTable
ALTER TABLE "team_members" ALTER COLUMN "source_team" DROP NOT NULL,
ALTER COLUMN "source_team" DROP DEFAULT;
