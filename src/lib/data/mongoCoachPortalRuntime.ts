import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_SCHEDULE_MODELS, MongoCoachScheduleRepository, prepareMongoCoachScheduleStore } from "./mongoCoachScheduleRepository";
import { COACH_TOKEN_MODELS, MongoCoachTokenRepository, prepareMongoCoachTokenStore } from "./mongoCoachTokenRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_COACH_PORTAL_RUNTIME_MODELS = [...new Set([
  ...COACH_TOKEN_MODELS, ...COACH_SCHEDULE_MODELS, ...REQUEST_AUDIT_MODELS,
])] as readonly string[];
type Options = MongoOperationOptions & { allowShadowWrites: true };
type ScopeKey = "coachToken" | "coachSchedule" | "requestActivity";
export type MongoCoachPortalRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;

export interface MongoCoachPortalRuntime {
  readonly repositories: MongoCoachPortalRepositories;
  run<T>(work: () => T): T;
}
function runtime(repositories: MongoCoachPortalRepositories): MongoCoachPortalRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({ repositories, run<T>(work: () => T): T {
    return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
  } });
}
export async function openMongoCoachPortalRuntime(options: Options): Promise<MongoCoachPortalRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [coachToken, coachSchedule, requestActivity] = await Promise.all([
      MongoCoachTokenRepository.open(options), MongoCoachScheduleRepository.open(options), MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ coachToken, coachSchedule, requestActivity }));
  } catch { throw new Error("MONGO_COACH_PORTAL_RUNTIME_FAILED"); }
}
export async function prepareMongoCoachPortalRuntime(options: Options): Promise<MongoCoachPortalRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_COACH_PORTAL_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoCoachScheduleStore(options);
      await prepareMongoCoachTokenStore(options);
    }
    return await openMongoCoachPortalRuntime(options);
  } catch { throw new Error("MONGO_COACH_PORTAL_RUNTIME_FAILED"); }
}
