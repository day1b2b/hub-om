import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { EGG_REPOSITORY_MODELS, MongoEggRepository } from "./eggs/mongoEggRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoSupplyRepository, SUPPLY_REPOSITORY_MODELS } from "./supplies/mongoSupplyRepository";
import { MONGO_TEAM_USER_MODELS, MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };
export const MONGO_EGG_RUNTIME_MODELS = [...new Set([...EGG_REPOSITORY_MODELS, ...MONGO_TEAM_USER_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];
export const MONGO_SUPPLY_RUNTIME_MODELS = [...new Set([...SUPPLY_REPOSITORY_MODELS, ...MONGO_TEAM_USER_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];
export type MongoEggRepositories = Readonly<Pick<DataRepositories, "eggs" | "teamUsers" | "requestActivity">>;
export type MongoSupplyRepositories = Readonly<Pick<DataRepositories, "supplies" | "teamUsers" | "requestActivity">>;
export interface MongoEggSupplyRuntime<R> { readonly repositories: R; run<T>(work: () => T): T }

/**
 * 에그·물품 route는 withActivity로 감싸져 있어, 요청 기록(requestActivity)과 사용자(teamUsers)를
 * 같은 범위에 함께 열어야 한다. 빠지면 요청 기록 단계에서 DATA_REPOSITORY_NOT_CONFIGURED로 500이 난다.
 */
function runtimeOf<R extends Readonly<Partial<DataRepositories>>>(repositories: R): MongoEggSupplyRuntime<R> {
  registerDataRepositoryScope(repositories);
  return Object.freeze({ repositories, run<T>(work: () => T): T {
    return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
  } });
}

/** Opens prepared storage only; request handling never creates or repairs collections. */
export async function openMongoEggRuntime(options: Options): Promise<MongoEggSupplyRuntime<MongoEggRepositories>> {
  try {
    const [eggs, teamUsers, requestActivity] = await Promise.all([
      MongoEggRepository.open(options), MongoTeamUserRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    return runtimeOf<MongoEggRepositories>(Object.freeze({ eggs, teamUsers, requestActivity }));
  } catch { throw new Error("MONGO_EGG_RUNTIME_FAILED"); }
}

export async function openMongoSupplyRuntime(options: Options): Promise<MongoEggSupplyRuntime<MongoSupplyRepositories>> {
  try {
    const [supplies, teamUsers, requestActivity] = await Promise.all([
      MongoSupplyRepository.open(options), MongoTeamUserRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    return runtimeOf<MongoSupplyRepositories>(Object.freeze({ supplies, teamUsers, requestActivity }));
  } catch { throw new Error("MONGO_SUPPLY_RUNTIME_FAILED"); }
}

/** Test/bootstrap boundary. Prepares only an empty shadow namespace; existing state is never repaired. */
export async function prepareMongoEggSupplyRuntime(options: Options): Promise<{
  eggs: MongoEggSupplyRuntime<MongoEggRepositories>; supplies: MongoEggSupplyRuntime<MongoSupplyRepositories>;
}> {
  try {
    new MongoOperationStore(options, [...new Set([...MONGO_EGG_RUNTIME_MODELS, ...MONGO_SUPPLY_RUNTIME_MODELS])]);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoReadStore(options, [...EGG_REPOSITORY_MODELS, ...SUPPLY_REPOSITORY_MODELS]);
      await prepareMongoTeamUserStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return { eggs: await openMongoEggRuntime(options), supplies: await openMongoSupplyRuntime(options) };
  } catch { throw new Error("MONGO_EGG_SUPPLY_RUNTIME_FAILED"); }
}
