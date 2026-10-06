import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_TOKEN_BACKFILL_MODELS, MongoCoachTokenBackfillRepository } from "./mongoCoachTokenBackfillRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };

/** Open-only maintenance runtime. The CLI must never create or repair a shadow namespace. */
export async function openMongoCoachTokenBackfillRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ coachTokenBackfill: await MongoCoachTokenBackfillRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      },
    });
  } catch {
    throw new Error("MONGO_COACH_TOKEN_BACKFILL_RUNTIME_FAILED");
  }
}

export { COACH_TOKEN_BACKFILL_MODELS as MONGO_COACH_TOKEN_BACKFILL_RUNTIME_MODELS };
