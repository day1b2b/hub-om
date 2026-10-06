import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoOperationRepository } from "./mongoOperationRepository";
export async function openMongoSatisfactionDryRunRuntime(options: MongoOperationOptions) {
  try { const repositories = Object.freeze({ operations: await MongoOperationRepository.open(options) }); registerDataRepositoryScope(repositories); return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } }); }
  catch { throw new Error("MONGO_SATISFACTION_DRY_RUN_RUNTIME_FAILED"); }
}
