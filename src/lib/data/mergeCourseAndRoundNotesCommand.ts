import type { OperationRepository } from "./operationRepository";
import { getOperationRepository } from "./operationRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";
import { planMergeCourseAndRoundNotes, type MergeCourseAndRoundNotesFieldSummary } from "./mergeCourseAndRoundNotes";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export interface MergeCourseAndRoundNotesSummary {
  apply: boolean;
  courseCount: number;
  summaryByField: Record<"specialNotes" | "operationIssue" | "omUpdate", MergeCourseAndRoundNotesFieldSummary>;
  updatedCount: number;
}

interface Dependencies {
  repository(): OperationRepository;
  close(): Promise<void>;
}

const defaults: Dependencies = { repository: getOperationRepository, close: disconnectPrismaClient };

export async function runMergeCourseAndRoundNotesCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults
): Promise<MergeCourseAndRoundNotesSummary> {
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("MERGE_COURSE_AND_ROUND_NOTES_CONFIRMATION_REQUIRED");
  }
  let result: MergeCourseAndRoundNotesSummary | undefined;
  let failed = false;
  const scoped = getDataRepositoryOverride("operations");
  try {
    if (!scoped) loadEnvironment();
    const repository = scoped ?? dependencies.repository();
    const plan = planMergeCourseAndRoundNotes(await repository.listOperations());
    let updatedCount = 0;
    if (apply) {
      for (const candidate of plan.candidates) {
        await repository.upsertCourseCommonNote(candidate.courseRecordId, candidate.input, "system:merge-course-and-round-notes");
        updatedCount++;
      }
    }
    result = { apply, courseCount: plan.courseCount, summaryByField: plan.summaryByField, updatedCount };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("MERGE_COURSE_AND_ROUND_NOTES_FAILED");
  return result;
}
