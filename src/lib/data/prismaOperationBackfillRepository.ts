import { OnsiteRequired, OperationStatus } from "@prisma/client";
import { ASSIGNMENT_NEEDED_VALUES } from "./operationCalculations";
import { countOmStatusBackfill, omStatusBackfillValue, type OmStatusBackfillCounts, type OmStatusBackfillValue } from "./omAssignmentStatusBackfillPlan";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import { getPrismaClient } from "./prisma";

const onsiteTargets = () => ({ deletedAt: null, onsiteRequired: { not: OnsiteRequired.Y } });
const omTargets = () => ({
  deletedAt: null,
  operationStatus: OperationStatus.ASSIGNMENT_NEEDED,
  omName: { not: null, notIn: ["", ...Array.from(ASSIGNMENT_NEEDED_VALUES)] }
});
const omPlanSelect = {
  id: true, endDate: true, lectureManagementNote: true, avgSatisfaction: true, hasSatisfactionSurvey: true,
  hasResultReport: true, resultReportLink: true, course: { select: { courseId: true } }
} as const;
type OmPlanRow = Awaited<ReturnType<typeof listOmPlanRows>>[number];
const listOmPlanRows = () => getPrismaClient().operationSession.findMany({ where: omTargets(), select: omPlanSelect });
const planValue = (row: OmPlanRow) => omStatusBackfillValue({ ...row, courseId: row.course.courseId });

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
  async previewOmAssignmentStatusBackfill(): Promise<OmStatusBackfillCounts> {
    return countOmStatusBackfill((await listOmPlanRows()).map(planValue));
  }
  async applyOmAssignmentStatusBackfill(): Promise<number> {
    const groups = new Map<OmStatusBackfillValue, string[]>();
    for (const row of await listOmPlanRows()) groups.set(planValue(row), [...(groups.get(planValue(row)) ?? []), row.id]);
    // Re-check the original target condition per row so a concurrent edit is never overwritten.
    const results = await getPrismaClient().$transaction([...groups].map(([value, ids]) => getPrismaClient().operationSession.updateMany({
      where: { ...omTargets(), id: { in: ids } }, data: { operationStatus: OperationStatus[value] }
    })));
    return results.reduce((sum, result) => sum + result.count, 0);
  }
}
