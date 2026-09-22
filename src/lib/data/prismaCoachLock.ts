import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Shared by native schedule/reservation/engagement writers. External sync writers are separate follow-up work. */
export async function lockPrismaCoach(tx: Prisma.TransactionClient, coachId: string): Promise<void> {
  const lockKey = createHash("sha256").update(`coach-schedule:${coachId.toLowerCase()}`).digest().readBigInt64BE();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lockKey}::bigint)`;
}
