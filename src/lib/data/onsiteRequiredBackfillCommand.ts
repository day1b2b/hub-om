import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getOperationBackfillRepository } from "./operationBackfillRepositoryFactory";
import { disconnectPrismaClient } from "./prisma";

export interface OnsiteRequiredBackfillSummary {
  apply: boolean;
  targetCount: number;
  updatedCount: number;
}

interface Dependencies {
  getDefaultRepository: typeof getOperationBackfillRepository;
  closeDefaultRepository(): Promise<void>;
}
const defaults: Dependencies = { getDefaultRepository: getOperationBackfillRepository, closeDefaultRepository: disconnectPrismaClient };

/** Shared by the legacy-compatible PG CLI and an explicitly scoped shadow runtime. */
export async function runOnsiteRequiredBackfillCommand(
  args: string[], loadEnvironment: () => void,
  dependencies: Dependencies = defaults,
): Promise<OnsiteRequiredBackfillSummary> {
  const apply = args.includes("--apply");
  const scoped = getDataRepositoryOverride("operationBackfill");
  let result: OnsiteRequiredBackfillSummary | undefined, failed = false;
  try {
    if (!scoped) loadEnvironment();
    const repository = scoped ?? dependencies.getDefaultRepository();
    const targetCount = await repository.countOnsiteRequiredTargets();
    const updatedCount = apply ? await repository.applyOnsiteRequiredBackfill() : 0;
    result = { apply, targetCount, updatedCount };
  } catch { failed = true; }
  finally { if (!scoped) { try { await dependencies.closeDefaultRepository(); } catch { failed = true; } } }
  if (failed || !result) throw new Error("ONSITE_REQUIRED_BACKFILL_FAILED");
  return result;
}
