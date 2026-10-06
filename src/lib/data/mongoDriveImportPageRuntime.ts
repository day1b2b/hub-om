import type { DataRepositories } from "./dataRepositoryContext";
import {
  registerDataRepositoryScope,
  runWithDataRepositories,
  runWithLockedRepositoryScope
} from "./dataRepositoryContext";
import {
  DRIVE_IMPORT_HISTORY_MODELS,
  MongoDriveImportHistoryRepository
} from "./mongoDriveImportHistoryRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
type Repositories = Readonly<Pick<DataRepositories, "driveImportHistory" | "teamMembers">>;

export const MONGO_DRIVE_IMPORT_PAGE_MODELS = [
  ...DRIVE_IMPORT_HISTORY_MODELS,
  ...TEAM_READ_MODELS
] as const;

export async function openMongoDriveImportPageRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_DRIVE_IMPORT_PAGE_MODELS);
    const repositories: Repositories = Object.freeze({
      driveImportHistory: await MongoDriveImportHistoryRepository.open(options),
      teamMembers: await MongoTeamMemberRepository.open(options)
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
      }
    });
  } catch {
    throw new Error("MONGO_DRIVE_IMPORT_PAGE_RUNTIME_FAILED");
  }
}
