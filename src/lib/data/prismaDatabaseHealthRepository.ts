import type { DatabaseHealthRepository } from "./databaseHealthRepository";
import { getPrismaClient } from "./prisma";

export class PrismaDatabaseHealthRepository implements DatabaseHealthRepository {
  async check(): Promise<void> {
    try {
      const prisma = getPrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new Error("DATABASE_HEALTH_CHECK_FAILED");
    }
  }
}
