import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoOmRequestRepository, OM_REQUEST_MODELS, prepareMongoOmRequestStore } from "./mongoOmRequestRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

type ScopeKey = "operations" | "teamMembers" | "teamUsers" | "omRequests";
type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoOverviewPagesRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_OVERVIEW_PAGES_MODELS = [...new Set([...OPERATION_MODELS, ...TEAM_READ_MODELS, ...OM_REQUEST_MODELS])] as readonly string[];

export interface MongoOverviewPagesRuntime {
  readonly repositories: MongoOverviewPagesRepositories;
  run<T>(work: () => T): T;
}

/** Prepares only a completely empty shadow namespace. */
export async function prepareMongoOverviewPagesRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoOverviewPagesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OVERVIEW_PAGES_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoTeamUserStore(options);
      await prepareMongoOmRequestStore(options);
    }
    return await openMongoOverviewPagesRuntime(options);
  } catch { throw new Error("MONGO_OVERVIEW_PAGES_RUNTIME_FAILED"); }
}

/** Opens the four page repositories on one explicit client/database/namespace. */
export async function openMongoOverviewPagesRuntime(options: Options): Promise<MongoOverviewPagesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OVERVIEW_PAGES_MODELS);
    const [operations, teamMembers, teamUsers, omRequests] = await Promise.all([
      MongoOperationRepository.open(options), MongoTeamMemberRepository.open(options),
      MongoTeamUserRepository.open(options), MongoOmRequestRepository.open(options),
    ]);
    const repositories: MongoOverviewPagesRepositories = Object.freeze({ operations, teamMembers, teamUsers, omRequests });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_OVERVIEW_PAGES_RUNTIME_FAILED"); }
}
