import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoCoachDbArchiveRepository } from "./mongoCoachDbArchiveRepository";
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function openMongoCoachDbArchiveRuntime(options: Options) { try { const repositories = Object.freeze({ coachDbArchive: await MongoCoachDbArchiveRepository.open(options) });
  registerDataRepositoryScope(repositories); return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } }); }
catch { throw new Error("MONGO_COACH_DB_ARCHIVE_RUNTIME_FAILED"); } }
