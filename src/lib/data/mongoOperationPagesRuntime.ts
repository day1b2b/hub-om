import type { OmCustomToolsRepository } from "./omRequest/omRequestRepository";
import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoCoachRepository } from "./mongoCoachRepository";
import { MongoOmRequestRepository, OM_REQUEST_MODELS, prepareMongoOmRequestStore } from "./mongoOmRequestRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { COACH_READ_MODELS, prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

type ScopeKey = "operations" | "teamUsers" | "teamMembers" | "instructorNote" | "coach" | "omRequests" | "omCustomTools";
export type MongoOperationPagesRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
type Options = MongoOperationOptions & { allowShadowWrites: true; omCustomTools: OmCustomToolsRepository };
export const MONGO_OPERATION_PAGES_RUNTIME_MODELS = [...new Set([
  ...OPERATION_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...COACH_READ_MODELS, ...OM_REQUEST_MODELS,
])] as readonly string[];

export interface MongoOperationPagesRuntime {
  readonly repositories: MongoOperationPagesRepositories;
  run<T>(work: () => T): T;
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoOperationPagesRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoOperationPagesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OPERATION_PAGES_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
      await prepareMongoTeamUserStore(options);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoReadStore(options, COACH_READ_MODELS);
      await prepareMongoOmRequestStore(options);
    }
    return await openMongoOperationPagesRuntime(options);
  } catch { throw new Error("MONGO_OPERATION_PAGES_RUNTIME_FAILED"); }
}

/** Operation list/detail/new-page storage scope. External custom tools stay an explicit borrowed port. */
export async function openMongoOperationPagesRuntime(options: Options): Promise<MongoOperationPagesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OPERATION_PAGES_RUNTIME_MODELS);
    const [operations, teamUsers, teamMembers, instructorNote, coach, omRequests] = await Promise.all([
      MongoOperationRepository.open(options), MongoTeamUserRepository.open(options), MongoTeamMemberRepository.open(options),
      MongoInstructorNoteRepository.open(options), MongoCoachRepository.open(options), MongoOmRequestRepository.open(options)
    ]);
    const omCustomTools: OmCustomToolsRepository = Object.freeze({
      list: () => options.omCustomTools.list(), add: (names: string[]) => options.omCustomTools.add(names),
    });
    const repositories: MongoOperationPagesRepositories = Object.freeze({ operations, teamUsers, teamMembers, instructorNote, coach, omRequests, omCustomTools });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const code = /^[A-Z0-9_:\- ]{1,160}$/.test(message) ? message : "REDACTED";
    console.error("MONGO_OPERATION_PAGES_RUNTIME_FAILED", code);
    throw new Error("MONGO_OPERATION_PAGES_RUNTIME_FAILED");
  }
}
