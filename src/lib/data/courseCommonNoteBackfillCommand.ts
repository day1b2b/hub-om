import type { OperationRepository } from "./operationRepository";
import { getOperationRepository } from "./operationRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";
import { planCourseCommonNoteBackfill } from "./courseCommonNoteBackfill";

export interface CourseCommonNoteBackfillSummary {
  apply: boolean;
  courseCount: number;
  candidateCount: number;
  conflictCourseCount: number;
  skippedExistingFieldCount: number;
  updatedCount: number;
}

interface Dependencies {
  repository(): OperationRepository;
  close(): Promise<void>;
}

const defaults: Dependencies = { repository: getOperationRepository, close: disconnectPrismaClient };

export async function runCourseCommonNoteBackfillCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults,
): Promise<CourseCommonNoteBackfillSummary> {
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("COURSE_COMMON_NOTE_BACKFILL_CONFIRMATION_REQUIRED");
  }
  let result: CourseCommonNoteBackfillSummary | undefined;
  let failed = false;
  try {
    loadEnvironment();
    const repository = dependencies.repository();
    const plan = planCourseCommonNoteBackfill(await repository.listOperations());
    let updatedCount = 0;
    if (apply) {
      for (const candidate of plan.candidates) {
        await repository.upsertCourseCommonNote(candidate.courseRecordId, candidate.input, "system:course-common-note-backfill");
        updatedCount++;
      }
    }
    result = { apply, courseCount: plan.courseCount, candidateCount: plan.candidateCount, conflictCourseCount: plan.conflictCourseCount, skippedExistingFieldCount: plan.skippedExistingFieldCount, updatedCount };
  } catch { failed = true; }
  finally { try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COURSE_COMMON_NOTE_BACKFILL_FAILED");
  return result;
}
