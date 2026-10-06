import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoInstructorNoteImportRepository } from "./mongoInstructorNoteImportRepository";
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function openMongoInstructorNoteImportRuntime(options: Options) {
  try { const repositories = Object.freeze({ instructorNoteImport: await MongoInstructorNoteImportRepository.open(options) }); registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } }); }
  catch { throw new Error("MONGO_INSTRUCTOR_NOTE_IMPORT_RUNTIME_FAILED"); }
}
