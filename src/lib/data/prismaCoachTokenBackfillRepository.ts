import { backfillCoachAccessTokens } from "./coachAccessTokenBackfill";
import type { CoachTokenBackfillRepository } from "./coachTokenBackfillRepository";
import { getPrismaClient } from "./prisma";

/** Default CLI job backend, including the existing encryption/activity wrappers. */
export class PrismaCoachTokenBackfillRepository implements CoachTokenBackfillRepository {
  async backfill(options: { apply: boolean }) {
    const db = getPrismaClient();
    try { return await backfillCoachAccessTokens(db, options); }
    finally { await db.$disconnect(); }
  }
}
