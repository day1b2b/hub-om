-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "source_team" "source_team" NOT NULL DEFAULT 'unknown',
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "role_title" TEXT,
    "calendar_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_members_source_team_normalized_name_key" ON "team_members"("source_team", "normalized_name");

-- CreateIndex
CREATE INDEX "team_members_source_team_is_active_idx" ON "team_members"("source_team", "is_active");
