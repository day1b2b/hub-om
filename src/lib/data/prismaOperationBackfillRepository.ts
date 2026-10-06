import { OnsiteRequired, OperationStatus } from "@prisma/client";
import { ASSIGNMENT_NEEDED_VALUES } from "./operationCalculations";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { getPrismaClient } from "./prisma";

const onsiteTargets = () => ({ deletedAt: null, onsiteRequired: { not: OnsiteRequired.Y } });
const omTargets = () => ({
  deletedAt: null,
  operationStatus: OperationStatus.ASSIGNMENT_NEEDED,
  omName: { not: null, notIn: ["", ...Array.from(ASSIGNMENT_NEEDED_VALUES)] }
});

/** Preserve the original administrator queries, including exact placeholder matching. */
export class PrismaOperationBackfillRepository implements OperationBackfillRepository {
  countOnsiteRequiredTargets(): Promise<number> {
    return getPrismaClient().operationSession.count({ where: onsiteTargets() });
  }
  async applyOnsiteRequiredBackfill(): Promise<number> {
    const result = await getPrismaClient().operationSession.updateMany({
      where: onsiteTargets(), data: { onsiteRequired: OnsiteRequired.Y }
    });
    return result.count;
  }
  countOmAssignmentStatusTargets(): Promise<number> {
    return getPrismaClient().operationSession.count({ where: omTargets() });
  }
  async applyOmAssignmentStatusBackfill(): Promise<number> {
    const result = await getPrismaClient().operationSession.updateMany({
      where: omTargets(), data: { operationStatus: OperationStatus.ASSIGNMENT_PLANNED }
    });
    return result.count;
  }
}
