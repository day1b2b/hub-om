import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Shared by schedule, reservation, engagement, management and sheet writers. */
export async function lockPrismaCoach(tx: Prisma.TransactionClient, coachId: string): Promise<void> {
  const lockKey = createHash("sha256").update(`coach-schedule:${coachId.toLowerCase()}`).digest().readBigInt64BE();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lockKey}::bigint)`;
}

/** Serializes coach identity and engagement-set changes before per-coach locks. */
export async function lockPrismaCoachCatalog(tx: Prisma.TransactionClient): Promise<void> {
  const lockKey = createHash("sha256").update("coach-catalog").digest().readBigInt64BE();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lockKey}::bigint)`;
}
