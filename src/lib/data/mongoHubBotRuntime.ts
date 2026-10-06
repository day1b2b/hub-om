import type { HubBotResponder } from "../hubBot/hubBotResponder";
import type { HubBotChatTurn } from "../hubBot/claudeClient";
import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";

type ScopeKey = "hubBotResponder" | "requestActivity";
type Options = MongoOperationOptions & { allowShadowWrites: true; hubBotResponder: HubBotResponder };
export type MongoHubBotRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_HUBBOT_RUNTIME_MODELS = [...REQUEST_AUDIT_MODELS] as readonly string[];

export interface MongoHubBotRuntime {
  readonly repositories: MongoHubBotRepositories;
  run<T>(work: () => T): T;
}

export async function prepareMongoHubBotRuntime(options: Options): Promise<MongoHubBotRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_HUBBOT_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoRequestAuditStore(options);
    return await openMongoHubBotRuntime(options);
  } catch { throw new Error("MONGO_HUBBOT_RUNTIME_FAILED"); }
}

export async function openMongoHubBotRuntime(options: Options): Promise<MongoHubBotRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_HUBBOT_RUNTIME_MODELS);
    const hubBotResponder: HubBotResponder = Object.freeze({
      reply: (question: string, history: HubBotChatTurn[]) => options.hubBotResponder.reply(question, history)
    });
    const repositories: MongoHubBotRepositories = Object.freeze({
      hubBotResponder,
      requestActivity: await MongoRequestAuditRepository.open(options)
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_HUBBOT_RUNTIME_FAILED"); }
}
