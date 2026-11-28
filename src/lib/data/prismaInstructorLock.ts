import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Serializes instructor engagement-set changes (coach prismaCoachLock의 카탈로그 락 미러, 별도 키). */
export async function lockPrismaInstructorCatalog(tx: Prisma.TransactionClient): Promise<void> {
  const lockKey = createHash("sha256").update("instructor-catalog").digest().readBigInt64BE();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lockKey}::bigint)`;
}
