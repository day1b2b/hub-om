import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoImportPromotionRepository } from "./mongoImportPromotionRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };

export async function openMongoSourceOnlyPromotionRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ sourceOnlyPromotion: await MongoImportPromotionRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_SOURCE_ONLY_PROMOTION_RUNTIME_FAILED"); }
}
