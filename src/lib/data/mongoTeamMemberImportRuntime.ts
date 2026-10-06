import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoTeamMemberImportRepository } from "./mongoTeamMemberImportRepository";
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function openMongoTeamMemberImportRuntime(options: Options) {
  try { const repositories = Object.freeze({ teamMemberImport: await MongoTeamMemberImportRepository.open(options) }); registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } }); }
  catch { throw new Error("MONGO_TEAM_MEMBER_IMPORT_RUNTIME_FAILED"); }
}
