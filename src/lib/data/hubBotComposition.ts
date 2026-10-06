import { MongoClient } from "mongodb";
import type { HubBotResponder } from "../hubBot/hubBotResponder";
import { getHubBotResponder } from "../hubBot/hubBotResponder";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }

export interface HubBotCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  responder(): HubBotResponder;
  openRuntime(input: {
    client: Client;
    databaseName: string;
    namespace: string;
    allowShadowWrites: true;
    hubBotResponder: HubBotResponder;
  }): Promise<Runtime>;
}

const defaults: HubBotCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  responder: getHubBotResponder,
  openRuntime: async input => {
    const { openMongoHubBotRuntime } = await import("./mongoHubBotRuntime");
    return openMongoHubBotRuntime({ ...input, client: input.client as MongoClient });
  }
};

export async function runHubBotRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: HubBotCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.HUBBOT_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("HUBBOT_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    const hubBotResponder = dependencies.responder();
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, hubBotResponder });
    return await runtime.run(work);
  } catch (error) {
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest)) throw error;
    throw new Error("HUBBOT_COMPOSITION_FAILED");
  }
  finally { if (client) try { await client.close(); } catch {} }
}
