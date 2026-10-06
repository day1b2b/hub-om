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
      databaseHealth: new MongoDatabaseHealthRepository(options.client, options.databaseName)
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
