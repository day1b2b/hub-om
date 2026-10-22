import type { DataRepositories } from "./dataRepositoryContext";
import {
  registerDataRepositoryScope,
  runWithDataRepositories,
  runWithLockedRepositoryScope
} from "./dataRepositoryContext";
import { MongoDatabaseHealthRepository } from "./mongoDatabaseHealthRepository";
import type { MongoOperationOptions } from "./mongoOperationStore";

type Repositories = Readonly<Pick<DataRepositories, "databaseHealth">>;

export function openMongoHealthRuntime(options: MongoOperationOptions) {
  try {
    const repositories: Repositories = Object.freeze({
      // Same read-only readiness the operation runtimes run on open; a contract/validator mismatch fails health.
      // Loaded on use so the health route's import graph stays ping-only.
      databaseHealth: new MongoDatabaseHealthRepository(options.client, options.databaseName, async () => {
        const { assertMongoOperationStoreReady, MongoOperationStore } = await import("./mongoOperationStore");
        await assertMongoOperationStoreReady(new MongoOperationStore(options));
      })
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_HEALTH_RUNTIME_FAILED");
  }
}
