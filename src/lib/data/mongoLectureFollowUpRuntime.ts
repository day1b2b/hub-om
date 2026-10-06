import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MONGO_TEAM_USER_MODELS, MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";
import type { LectureFollowUpNotifier } from "../reminders/lectureFollowUpReminder";
import { MongoLectureFollowUpSentLog, prepareMongoLectureFollowUpSentLog } from "./mongoLectureFollowUpSentLog";

type ScopeKey = "lectureFollowUpNotifier" | "lectureFollowUpSentLog" | "operations" | "requestActivity" | "teamUsers";
type Options = MongoOperationOptions & { allowShadowWrites: true; lectureFollowUpNotifier: LectureFollowUpNotifier };
export type MongoLectureFollowUpRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_LECTURE_FOLLOW_UP_MODELS = [...new Set([
  ...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS, ...MONGO_TEAM_USER_MODELS,
])] as readonly string[];

export interface MongoLectureFollowUpRuntime {
  readonly repositories: MongoLectureFollowUpRepositories;
  run<T>(work: () => T): T;
}

/** Prepares only a completely empty synthetic/shadow namespace. */
export async function prepareMongoLectureFollowUpRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoLectureFollowUpRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_LECTURE_FOLLOW_UP_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoOperationStore(options);
      await prepareMongoTeamUserStore(options);
      await prepareMongoLectureFollowUpSentLog(new MongoOperationStore(options, MONGO_LECTURE_FOLLOW_UP_MODELS), options.allowShadowWrites);
    }
    return await openMongoLectureFollowUpRuntime(options);
  } catch { throw new Error("MONGO_LECTURE_FOLLOW_UP_RUNTIME_FAILED"); }
}

/** Opens Mongo reads, request audit and explicit effect ports as one locked scope. */
export async function openMongoLectureFollowUpRuntime(options: Options): Promise<MongoLectureFollowUpRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_LECTURE_FOLLOW_UP_MODELS);
    const store = new MongoOperationStore(options, MONGO_LECTURE_FOLLOW_UP_MODELS);
    const [operations, requestActivity, teamUsers, lectureFollowUpSentLog] = await Promise.all([
      MongoOperationRepository.open(options), MongoRequestAuditRepository.open(options), MongoTeamUserRepository.open(options),
      MongoLectureFollowUpSentLog.open(store),
    ]);
    const lectureFollowUpNotifier: LectureFollowUpNotifier = Object.freeze({
      send: (slackId: string, message: string) => options.lectureFollowUpNotifier.send(slackId, message)
    });
    const repositories: MongoLectureFollowUpRepositories = Object.freeze({
      lectureFollowUpNotifier, lectureFollowUpSentLog, operations, requestActivity, teamUsers
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_LECTURE_FOLLOW_UP_RUNTIME_FAILED"); }
}
