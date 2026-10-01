import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
export interface ActivityReadCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string }): Promise<Runtime>;
}
const defaults: ActivityReadCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: async input => {
    const { openMongoActivityReadRuntime } = await import("./mongoActivityReadRuntime");
    return openMongoActivityReadRuntime({ ...input, client: input.client as MongoClient });
  }
};
export async function runActivityReadRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: ActivityReadCompositionDependencies = defaults): Promise<T> {
  const backend = environment.ACTIVITY_READ_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("ACTIVITY_READ_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace });
    return await runtime.run(work);
  } catch { throw new Error("ACTIVITY_READ_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
