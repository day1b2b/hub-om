import type { DataRepositories } from "./dataRepositoryContext";
import {
  registerDataRepositoryScope,
  runWithDataRepositories,
  runWithLockedRepositoryScope
} from "./dataRepositoryContext";
import { ADMIN_BACKUP_READ_MODELS, MongoAdminBackupRepository } from "./mongoAdminBackupRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
type Repositories = Readonly<Pick<DataRepositories, "adminBackup" | "requestActivity">>;

export const MONGO_ADMIN_BACKUP_RUNTIME_MODELS = [
  ...new Set([...ADMIN_BACKUP_READ_MODELS, ...REQUEST_AUDIT_MODELS])
] as readonly string[];

export async function openMongoAdminBackupRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_ADMIN_BACKUP_RUNTIME_MODELS);
    const repositories: Repositories = Object.freeze({
      adminBackup: await MongoAdminBackupRepository.open(options),
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
    throw new Error("MONGO_ADMIN_BACKUP_RUNTIME_FAILED");
  }
}
