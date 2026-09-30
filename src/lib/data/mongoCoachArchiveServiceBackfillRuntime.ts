import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { COACH_ARCHIVE_SERVICE_BACKFILL_MODELS, MongoCoachArchiveServiceBackfillRepository, prepareMongoCoachArchiveServiceBackfillStore } from "./mongoCoachArchiveServiceBackfillRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function openMongoCoachArchiveServiceBackfillRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ coachArchiveServiceBackfill: await MongoCoachArchiveServiceBackfillRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_COACH_ARCHIVE_SERVICE_BACKFILL_RUNTIME_FAILED"); }
}
export async function prepareMongoCoachArchiveServiceBackfillRuntime(options: Options) {
  try {
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoCoachArchiveServiceBackfillStore(options);
    return await openMongoCoachArchiveServiceBackfillRuntime(options);
  } catch { throw new Error("MONGO_COACH_ARCHIVE_SERVICE_BACKFILL_RUNTIME_FAILED"); }
}
export { COACH_ARCHIVE_SERVICE_BACKFILL_MODELS as MONGO_COACH_ARCHIVE_SERVICE_BACKFILL_RUNTIME_MODELS };
