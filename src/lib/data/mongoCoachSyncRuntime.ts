import type { CoachNotionSource } from "./coachNotionSyncRepository";
import { COACH_NOTION_SYNC_MODELS, MongoCoachNotionSyncRepository, prepareMongoCoachNotionSyncStore } from "./mongoCoachNotionSyncRepository";
import type { CoachSheetSource } from "./coachSheetSyncRepository";
import { COACH_SHEET_SYNC_MODELS, MongoCoachSheetSyncRepository, prepareMongoCoachSheetSyncStore } from "./mongoCoachSheetSyncRepository";
import { MongoCoachSyncLogRepository, prepareMongoCoachSyncLogStore } from "./mongoCoachSyncLogRepository";
import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

type ScopeKey = "coachNotionSync" | "coachNotionSource" | "coachSheetSync" | "coachSheetSource" | "coachSyncLog" | "requestActivity";
type Options = MongoOperationOptions & { allowShadowWrites: true; coachNotionSource: CoachNotionSource; coachSheetSource: CoachSheetSource };
export type MongoCoachSyncRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_COACH_SYNC_RUNTIME_MODELS = [...new Set([
  ...COACH_NOTION_SYNC_MODELS, ...COACH_SHEET_SYNC_MODELS, ...REQUEST_AUDIT_MODELS, "CoachSyncLog"
])] as readonly string[];

export interface MongoCoachSyncRuntime {
  readonly repositories: MongoCoachSyncRepositories;
  run<T>(work: () => T): T;
}

/** Explicit setup only. Existing or partial namespaces are never repaired. */
export async function prepareMongoCoachSyncRuntime(options: Options): Promise<MongoCoachSyncRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_COACH_SYNC_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoCoachNotionSyncStore(options);
      await prepareMongoCoachSheetSyncStore(options);
      await prepareMongoCoachSyncLogStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoCoachSyncRuntime(options);
  } catch { throw new Error("MONGO_COACH_SYNC_RUNTIME_FAILED"); }
}

/** All three scheduled sync routes share one locked namespace and explicit synthetic/source ports. */
export async function openMongoCoachSyncRuntime(options: Options): Promise<MongoCoachSyncRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_COACH_SYNC_RUNTIME_MODELS);
    const [coachNotionSync, coachSheetSync, coachSyncLog, requestActivity] = await Promise.all([
      MongoCoachNotionSyncRepository.open(options), MongoCoachSheetSyncRepository.open(options),
      MongoCoachSyncLogRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const coachNotionSource: CoachNotionSource = Object.freeze({ readPages: () => options.coachNotionSource.readPages() });
    const coachSheetSource: CoachSheetSource = Object.freeze({
      readContract: () => options.coachSheetSource.readContract(), readSamsung: () => options.coachSheetSource.readSamsung()
    });
    const repositories: MongoCoachSyncRepositories = Object.freeze({
      coachNotionSync, coachNotionSource, coachSheetSync, coachSheetSource, coachSyncLog, requestActivity
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_SYNC_RUNTIME_FAILED"); }
}
