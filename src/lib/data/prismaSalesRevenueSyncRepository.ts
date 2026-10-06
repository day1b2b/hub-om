import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./prisma";
import type { SalesRevenueSyncRepository, SalesRevenueUpdate, SalesRevenueSyncLogInput } from "./salesRevenueSyncRepository";

/** Keep the original PG query, pending order and transaction options. */
export class PrismaSalesRevenueSyncRepository implements SalesRevenueSyncRepository {
  async listCourses() {
    return getPrismaClient().course.findMany({
      where: { courseId: { not: "" } },
      select: { id: true, courseId: true, name: true, revenue: true, company: { select: { name: true } } }
    });
  }
  async applyUpdates(updates: readonly SalesRevenueUpdate[]): Promise<void> {
    await getPrismaClient().$transaction(
      async (tx) => {
        for (const update of updates) {
          await tx.course.update({
              where: { id: update.id },
            data: { revenue: update.revenue, revenueRaw: String(update.revenue) }
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
  }
  async recordLog(input: SalesRevenueSyncLogInput): Promise<void> {
    await getPrismaClient().salesRevenueSyncLog.create({ data: { ...input, detail: input.detail as Prisma.InputJsonValue } });
  }
}
