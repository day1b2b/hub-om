import type { OperationRepository } from "./operationRepository";
import { getOperationRepository } from "./operationRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";
import { planResultReportStatusPromotion, type ResultReportStatusPromotionSummary } from "./resultReportStatusPromotion";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

const ACTOR = "system:result-report-status-promotion";

export interface ResultReportStatusPromotionCommandSummary {
  apply: boolean;
  courseCount: number;
  summary: ResultReportStatusPromotionSummary;
  updatedCourseCount: number;
}

interface Dependencies {
  repository(): OperationRepository;
  close(): Promise<void>;
}

const defaults: Dependencies = { repository: getOperationRepository, close: disconnectPrismaClient };

export async function runResultReportStatusPromotionCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults,
): Promise<ResultReportStatusPromotionCommandSummary> {
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("RESULT_REPORT_STATUS_PROMOTION_CONFIRMATION_REQUIRED");
  }
  let result: ResultReportStatusPromotionCommandSummary | undefined;
  let failed = false;
  const scoped = getDataRepositoryOverride("operations");
  try {
    if (!scoped) loadEnvironment();
    const repository = scoped ?? dependencies.repository();
    const plan = planResultReportStatusPromotion(await repository.listOperations());

    let updatedCourseCount = 0;
    if (apply) {
      for (const course of plan.courses) {
        if (course.decision.kind !== "promote") continue;
        await repository.upsertCourseResultReportStatus(course.courseRecordId, course.decision.value, ACTOR);
        updatedCourseCount++;
      }
    }

    result = { apply, courseCount: plan.courseCount, summary: plan.summary, updatedCourseCount };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("RESULT_REPORT_STATUS_PROMOTION_FAILED");
  return result;
}
