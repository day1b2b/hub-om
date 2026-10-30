import type { OperationRepository } from "./operationRepository";
import { getOperationRepository } from "./operationRepositoryFactory";
import type { OmRequestRepository } from "./omRequest/omRequestRepository";
import { getOmRequestRepository } from "./omRequest/omRequestRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";
import { planSyncupRequestNoteCleanup, type SyncupCleanupPlan } from "./courseMergeReview";
import { getDataRepositoryOverride } from "./dataRepositoryContext";

export interface SyncupRequestNoteCleanupSummary {
  apply: boolean;
  plan: SyncupCleanupPlan;
  clearedRounds: number;
  updatedCommonNotes: number;
}

interface Dependencies {
  operations(): OperationRepository;
  omRequests(): OmRequestRepository;
  close(): Promise<void>;
}

const defaults: Dependencies = { operations: getOperationRepository, omRequests: getOmRequestRepository, close: disconnectPrismaClient };
const ACTOR = "system:syncup-request-note-cleanup";

export async function runSyncupRequestNoteCleanupCommand(
  args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults,
): Promise<SyncupRequestNoteCleanupSummary> {
  const apply = args.includes("--apply");
  if (apply && (!args.includes("--backup-confirmed") || !args.includes("--maintenance-confirmed"))) {
    throw new Error("SYNCUP_CLEANUP_CONFIRMATION_REQUIRED");
  }
  let result: SyncupRequestNoteCleanupSummary | undefined;
  let failed = false;
  const scoped = getDataRepositoryOverride("operations");
  try {
    if (!scoped) loadEnvironment();
    const operations = scoped ?? dependencies.operations();
    const plan = planSyncupRequestNoteCleanup(await operations.listOperations(), await dependencies.omRequests().listOmRequests());
    let clearedRounds = 0;
    let updatedCommonNotes = 0;
    if (apply) {
      for (const course of plan.courses) {
        // 문장을 공통 메모에 먼저 옮긴 뒤 싱크업을 비운다 — 중간에 끊겨도 문장이 사라지지 않는다.
        if (course.commonNoteChanged) {
          await operations.upsertCourseCommonNote(course.courseRecordId, course.commonNote, ACTOR);
          updatedCommonNotes++;
        }
        for (const operationId of course.operationIds) {
          await operations.updateOperation(operationId, { operationDetail: "" }, ACTOR);
          clearedRounds++;
        }
      }
    }
    result = { apply, plan, clearedRounds, updatedCommonNotes };
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("SYNCUP_CLEANUP_FAILED");
  return result;
}
