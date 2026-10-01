import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCalendarRuntime } from "./mongoCalendarRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface ImportPromotionCompositionDependencies {
  createClient(env: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; reflectOperations: false }): Promise<Runtime>;
}
const defaults: ImportPromotionCompositionDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoCalendarRuntime({ ...input, client: input.client as MongoClient })
};

export async function runImportPromotionRequest<T>(work: () => Promise<T>, env: MongoCompositionEnvironment = process.env, dependencies = defaults): Promise<T> {
  const backend = env.IMPORT_PROMOTION_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("IMPORT_PROMOTION_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(env);
    client = dependencies.createClient(env); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, reflectOperations: false });
    return await runtime.run(work);
  } catch { throw new Error("IMPORT_PROMOTION_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch { /* Preserve a completed audited response. */ } }
}
