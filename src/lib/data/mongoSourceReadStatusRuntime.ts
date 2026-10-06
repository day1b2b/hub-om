import type { OperationSourceReader } from "../sourceReads/sourceReadTypes";
import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

type ScopeKey = "operationSourceReader" | "requestActivity";
type Options = MongoOperationOptions & { allowShadowWrites: true; operationSourceReader: OperationSourceReader };
export type MongoSourceReadStatusRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_SOURCE_READ_STATUS_RUNTIME_MODELS = [...REQUEST_AUDIT_MODELS] as readonly string[];

export interface MongoSourceReadStatusRuntime {
  readonly repositories: MongoSourceReadStatusRepositories;
  run<T>(work: () => T): T;
}

export async function prepareMongoSourceReadStatusRuntime(options: Options): Promise<MongoSourceReadStatusRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SOURCE_READ_STATUS_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoRequestAuditStore(options);
    return await openMongoSourceReadStatusRuntime(options);
  } catch {
    throw new Error("MONGO_SOURCE_READ_STATUS_RUNTIME_FAILED");
  }
}

export async function openMongoSourceReadStatusRuntime(options: Options): Promise<MongoSourceReadStatusRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SOURCE_READ_STATUS_RUNTIME_MODELS);
    const operationSourceReader: OperationSourceReader = Object.freeze({
      readCourseBoard: () => options.operationSourceReader.readCourseBoard(),
      readCalendarEvents: () => options.operationSourceReader.readCalendarEvents(),
      readDiscussionReferences: () => options.operationSourceReader.readDiscussionReferences(),
      readSalesRecords: () => options.operationSourceReader.readSalesRecords()
    });
    const repositories: MongoSourceReadStatusRepositories = Object.freeze({
      operationSourceReader,
      requestActivity: await MongoRequestAuditRepository.open(options)
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_SOURCE_READ_STATUS_RUNTIME_FAILED");
  }
}
