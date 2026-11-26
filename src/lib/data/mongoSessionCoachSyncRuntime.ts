import { randomUUID } from "node:crypto";
import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { activityContext, type ActivityContext } from "../activity/context";
import { MongoSessionCoachSyncRepository, SESSION_COACH_SYNC_MODELS, prepareMongoSessionCoachSyncStore } from "./mongoSessionCoachSyncRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };

/** CLI 백필은 HTTP 요청 컨텍스트가 없으므로 합성 액터로 activity 컨텍스트를 세운다(쓰기의 ActivityChange 감사행용). */
function syntheticCliActor(): ActivityContext {
  return { requestId: randomUUID(), route: "/cli/sync-session-coaches", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "sync-session-coaches CLI", actorType: "development" };
}

/** Open-only. CLI는 섀도 네임스페이스를 생성·복구하지 않는다. */
export async function openMongoSessionCoachSyncRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ sessionCoachSync: await MongoSessionCoachSyncRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({
      repositories,
      run<T>(work: () => T): T {
        return activityContext.run(syntheticCliActor(), () => runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)));
      }
    });
  } catch { throw new Error("MONGO_SESSION_COACH_SYNC_RUNTIME_FAILED"); }
}

export async function prepareMongoSessionCoachSyncRuntime(options: Options) {
  try {
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoSessionCoachSyncStore(options);
    return await openMongoSessionCoachSyncRuntime(options);
  } catch { throw new Error("MONGO_SESSION_COACH_SYNC_RUNTIME_FAILED"); }
}

export { SESSION_COACH_SYNC_MODELS as MONGO_SESSION_COACH_SYNC_RUNTIME_MODELS };
