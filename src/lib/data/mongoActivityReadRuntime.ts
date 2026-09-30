import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoActivityReadRepository, prepareMongoActivityReadStore } from "./mongoActivityReadRepository";
import type { MongoOperationOptions } from "./mongoOperationStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

type PrepareOptions = MongoOperationOptions & { allowShadowWrites: true };
export type MongoActivityReadRepositories = Readonly<Pick<DataRepositories, "activityReads">>;

export interface MongoActivityReadRuntime {
  readonly repositories: MongoActivityReadRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoActivityReadRepositories): MongoActivityReadRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client activity-read scope without preparing or repairing collections. */
export async function openMongoActivityReadRuntime(options: MongoOperationOptions): Promise<MongoActivityReadRuntime> {
  try {
    return runtime(Object.freeze({ activityReads: await MongoActivityReadRepository.open(options) }));
  } catch { throw new Error("MONGO_ACTIVITY_READ_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoActivityReadRuntime(options: PrepareOptions): Promise<MongoActivityReadRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoActivityReadStore(options);
    return await openMongoActivityReadRuntime(options);
  } catch { throw new Error("MONGO_ACTIVITY_READ_RUNTIME_FAILED"); }
}
