-- CreateTable
CREATE TABLE "sales_revenue_sync_logs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "ambiguous" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" TEXT NOT NULL,
    "detail" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_revenue_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_revenue_sync_logs_started_at_idx" ON "sales_revenue_sync_logs"("started_at");
