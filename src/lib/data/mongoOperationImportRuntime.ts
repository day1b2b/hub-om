import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoImportPromotionRepository } from "./mongoImportPromotionRepository";
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function openMongoOperationImportRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ operationImport: await MongoImportPromotionRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_OPERATION_IMPORT_RUNTIME_FAILED"); }
}
