import type { InstructorNotionSource } from "./instructorNotionSyncRepository";
import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

type ScopeKey = "instructorNotionSync" | "instructorNotionSource" | "requestActivity";
type Options = MongoOperationOptions & { allowShadowWrites: true; instructorNotionSource: InstructorNotionSource };
export type MongoInstructorSyncRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_INSTRUCTOR_SYNC_RUNTIME_MODELS = [...new Set([...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];

export async function prepareMongoInstructorSyncRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_INSTRUCTOR_SYNC_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoInstructorSyncRuntime(options);
  } catch { throw new Error("MONGO_INSTRUCTOR_SYNC_RUNTIME_FAILED"); }
}

export async function openMongoInstructorSyncRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_INSTRUCTOR_SYNC_RUNTIME_MODELS);
    const [instructorNotionSync, requestActivity] = await Promise.all([
      MongoInstructorNoteRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const instructorNotionSource: InstructorNotionSource = Object.freeze({ readPages: () => options.instructorNotionSource.readPages() });
    const repositories: MongoInstructorSyncRepositories = Object.freeze({ instructorNotionSync, instructorNotionSource, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_INSTRUCTOR_SYNC_RUNTIME_FAILED"); }
}
