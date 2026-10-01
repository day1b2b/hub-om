import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoCoachRepository } from "./mongoCoachRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { COACH_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

type ScopeKey = "operations" | "instructorNote" | "coach";
export type MongoCoachPublicRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export const MONGO_COACH_PUBLIC_RUNTIME_MODELS = [...new Set([
  ...OPERATION_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...COACH_READ_MODELS
])] as readonly string[];

export interface MongoCoachPublicRuntime {
  readonly repositories: MongoCoachPublicRepositories;
  run<T>(work: () => T): T;
}

/** Test/bootstrap boundary. Existing namespaces receive a read-only readiness check. */
export async function prepareMongoCoachPublicRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoCoachPublicRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_PUBLIC_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoReadStore(options, COACH_READ_MODELS);
    }
    return await openMongoCoachPublicRuntime(options);
  } catch { throw new Error("MONGO_COACH_PUBLIC_RUNTIME_FAILED"); }
}

/** Opens prepared storage only; request handling never creates or repairs collections. */
export async function openMongoCoachPublicRuntime(options: Options): Promise<MongoCoachPublicRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_PUBLIC_RUNTIME_MODELS);
    const [operations, instructorNote, coach] = await Promise.all([
      MongoOperationRepository.open(options), MongoInstructorNoteRepository.open(options), MongoCoachRepository.open(options)
    ]);
    const repositories: MongoCoachPublicRepositories = Object.freeze({ operations, instructorNote, coach });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_PUBLIC_RUNTIME_FAILED"); }
}
