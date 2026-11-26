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
        // 서버 라우트에서 돌면 이미 선 activity 컨텍스트(실제 OM 액터)가 있으니 그대로 쓰고(감사에 OM 기록),
        // CLI 백필처럼 컨텍스트가 없을 때만 합성 액터를 세운다.
        const actor = activityContext.getStore() ?? syntheticCliActor();
        return activityContext.run(actor, () => runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)));
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
