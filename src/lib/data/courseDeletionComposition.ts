import { MongoClient } from "mongodb";
import { runAdminMaintenanceRequest } from "./adminMaintenanceComposition";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCalendarRuntime } from "./mongoCalendarRuntime";
import { MongoCourseAdminRepository } from "./mongoCourseAdminRepository";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import type { MongoCalendarOptions } from "./mongoCalendarOperationLock";

/** Course deletion needs the same Calendar scope as individual session deletion. */
export async function openMongoCourseDeletionRuntime(options: MongoCalendarOptions) {
  const calendar = await openMongoCalendarRuntime(options);
  const courseAdmin = await MongoCourseAdminRepository.open(options);
  const repositories = Object.freeze({ ...calendar.repositories, courseAdmin });
  registerDataRepositoryScope(repositories);
  return { repositories, run<T>(work: () => T): T {
    return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
  } };
}

export function runCourseDeletionRequest<T>(work: () => Promise<T>): Promise<T> {
  return runAdminMaintenanceRequest(work, process.env, {
    createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
    openRuntime: input => openMongoCourseDeletionRuntime({ ...input, client: input.client as MongoClient })
  });
}
