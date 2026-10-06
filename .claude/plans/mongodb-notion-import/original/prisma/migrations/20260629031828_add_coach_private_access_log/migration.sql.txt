-- CreateTable
CREATE TABLE "coach_private_access_logs" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "accessed_by_email" TEXT NOT NULL,
    "accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" TEXT,

    CONSTRAINT "coach_private_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_private_access_logs_coach_id_accessed_at_idx" ON "coach_private_access_logs"("coach_id", "accessed_at");

-- CreateIndex
CREATE INDEX "coach_private_access_logs_accessed_by_email_accessed_at_idx" ON "coach_private_access_logs"("accessed_by_email", "accessed_at");

-- AddForeignKey
ALTER TABLE "coach_private_access_logs" ADD CONSTRAINT "coach_private_access_logs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
