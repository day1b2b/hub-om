import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import type { SatisfactionSource } from "./satisfactionSource";
import { openSessionSurveyResultsOrUnavailable, SESSION_SURVEY_RESULT_MODELS } from "./mongoSessionSurveyResultRepository";
import { prepareMongoReadStore } from "./mongoReadStore";
import { MongoTeamUserRepository } from "./teamUsers/mongoTeamUserRepository";

type ScopeKey = "operations" | "satisfactionSource" | "requestActivity" | "sessionSurveyResults";
// 멤버(teamUsers)는 선택: "다른 사람이 반영" 판정에만 쓰는 읽기라, 열지 못해도 만족도 반영은 막지 않는다.
type Options = MongoOperationOptions & { allowShadowWrites: true; satisfactionSource: SatisfactionSource };
export type MongoSatisfactionRepositories = Readonly<Pick<DataRepositories, ScopeKey> & Partial<Pick<DataRepositories, "teamUsers">>>;
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
      await prepareMongoReadStore(options, SESSION_SURVEY_RESULT_MODELS);
    }
    return await openMongoSatisfactionRuntime(options);
  } catch { throw new Error("MONGO_SATISFACTION_RUNTIME_FAILED"); }
}

export async function openMongoSatisfactionRuntime(options: Options): Promise<MongoSatisfactionRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SATISFACTION_RUNTIME_MODELS);
    const [operations, requestActivity, sessionSurveyResults] = await Promise.all([
      MongoOperationRepository.open(options), MongoRequestAuditRepository.open(options), openSessionSurveyResultsOrUnavailable(options)
    ]);
    const satisfactionSource: SatisfactionSource = Object.freeze({
      readRows: (spreadsheetId: string, tabTitle: string) => options.satisfactionSource.readRows(spreadsheetId, tabTitle)
    });
    const teamUsers = await MongoTeamUserRepository.open({ client: options.client, databaseName: options.databaseName, namespace: options.namespace })
      .catch(() => undefined);
    const repositories: MongoSatisfactionRepositories = Object.freeze(teamUsers
      ? { operations, satisfactionSource, requestActivity, sessionSurveyResults, teamUsers }
      : { operations, satisfactionSource, requestActivity, sessionSurveyResults });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_SATISFACTION_RUNTIME_FAILED"); }
}
