ALTER TABLE "coaches"
  ADD COLUMN "access_token" TEXT;

CREATE UNIQUE INDEX "coaches_access_token_key" ON "coaches"("access_token");
