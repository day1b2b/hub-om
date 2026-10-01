import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import type { SatisfactionSource } from "./satisfactionSource";

type ScopeKey = "operations" | "satisfactionSource" | "requestActivity";
type Options = MongoOperationOptions & { allowShadowWrites: true; satisfactionSource: SatisfactionSource };
export type MongoSatisfactionRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_SATISFACTION_RUNTIME_MODELS = [...new Set([...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];

export interface MongoSatisfactionRuntime {
  readonly repositories: MongoSatisfactionRepositories;
  run<T>(work: () => T): T;
}

export async function prepareMongoSatisfactionRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoSatisfactionRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SATISFACTION_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoSatisfactionRuntime(options);
  } catch { throw new Error("MONGO_SATISFACTION_RUNTIME_FAILED"); }
}

export async function openMongoSatisfactionRuntime(options: Options): Promise<MongoSatisfactionRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SATISFACTION_RUNTIME_MODELS);
    const [operations, requestActivity] = await Promise.all([
      MongoOperationRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const satisfactionSource: SatisfactionSource = Object.freeze({
      readRows: (spreadsheetId: string, tabTitle: string) => options.satisfactionSource.readRows(spreadsheetId, tabTitle)
    });
    const repositories: MongoSatisfactionRepositories = Object.freeze({ operations, satisfactionSource, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_SATISFACTION_RUNTIME_FAILED"); }
}
