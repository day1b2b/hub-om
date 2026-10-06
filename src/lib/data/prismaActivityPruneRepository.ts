import { pruneActivityBatch } from "../activity/retention";
import type { ActivityPruneRepository } from "./activityPruneRepository";
import { getPrismaClient } from "./prisma";

export class PrismaActivityPruneRepository implements ActivityPruneRepository {
  private client?: ReturnType<typeof getPrismaClient>;

  async pruneBatch() {
    try {
      this.client ??= getPrismaClient();
      return await this.client.$transaction(pruneActivityBatch, { timeout: 10000 });
    } catch {
      throw new Error("ACTIVITY_PRUNE_FAILED");
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.$disconnect();
    } catch {
      throw new Error("ACTIVITY_PRUNE_FAILED");
    }
  }
}
