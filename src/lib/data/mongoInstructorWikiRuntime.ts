import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { prepareMongoReadStore } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_INSTRUCTOR_WIKI_RUNTIME_MODELS = [...new Set([
  ...INSTRUCTOR_NOTE_MODELS,
  ...REQUEST_AUDIT_MODELS
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoInstructorWikiRepositories = Readonly<Pick<DataRepositories, "instructorNote" | "requestActivity">>;
export interface MongoInstructorWikiRuntime {
  readonly repositories: MongoInstructorWikiRepositories;
  run<T>(work: () => T): T;
}

export async function openMongoInstructorWikiRuntime(options: Options): Promise<MongoInstructorWikiRuntime> {
  try {
    const [instructorNote, requestActivity] = await Promise.all([
      MongoInstructorNoteRepository.open(options),
      MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoInstructorWikiRepositories = Object.freeze({ instructorNote, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_INSTRUCTOR_WIKI_RUNTIME_FAILED");
  }
}

/** Explicit setup only. Existing or partial namespaces are checked without repair. */
export async function prepareMongoInstructorWikiRuntime(options: Options): Promise<MongoInstructorWikiRuntime> {
  try {
    new MongoOperationStore(options, MONGO_INSTRUCTOR_WIKI_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoInstructorWikiRuntime(options);
  } catch {
    throw new Error("MONGO_INSTRUCTOR_WIKI_RUNTIME_FAILED");
  }
}
