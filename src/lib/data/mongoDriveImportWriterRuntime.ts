import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import type { DriveImportSource } from "./driveImportSource";
import type { DriveImportOperation } from "./driveImportWriterRepository";
import { DRIVE_IMPORT_WRITER_MODELS, MongoDriveImportWriterRepository } from "./mongoDriveImportWriterRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";

type Options = MongoOperationOptions & { allowShadowWrites: true; driveImportSource: DriveImportSource };
type Repositories = Readonly<Pick<DataRepositories, "driveImportWriter" | "driveImportSource">>;

/** Open-only CLI runtime. A maintenance command must never create or repair a namespace. */
export async function openMongoDriveImportWriterRuntime(options: Options) {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, DRIVE_IMPORT_WRITER_MODELS);
    const driveImportWriter = await MongoDriveImportWriterRepository.open(options);
    const driveImportSource: DriveImportSource = Object.freeze({
      scan: (value: string) => options.driveImportSource.scan(value),
      search: (operation: DriveImportOperation) => options.driveImportSource.search(operation),
    });
    const repositories: Repositories = Object.freeze({ driveImportWriter, driveImportSource });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_DRIVE_IMPORT_WRITER_RUNTIME_FAILED"); }
}

export { DRIVE_IMPORT_WRITER_MODELS as MONGO_DRIVE_IMPORT_WRITER_RUNTIME_MODELS };
