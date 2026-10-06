import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import type { InstructorNotionSource } from "./instructorNotionSyncRepository";
import { openMongoInstructorSyncRuntime } from "./mongoInstructorSyncRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface InstructorSyncCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  source: InstructorNotionSource;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; instructorNotionSource: InstructorNotionSource }): Promise<Runtime>;
}
const defaults: InstructorSyncCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  source: Object.freeze({ async readPages() { return (await import("../instructors/notionInstructorSync")).readNotionInstructorPages(); } }),
  openRuntime: input => openMongoInstructorSyncRuntime({ ...input, client: input.client as MongoClient })
};
export async function runInstructorSyncRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: InstructorSyncCompositionDependencies = defaults): Promise<T> {
  const backend = environment.INSTRUCTOR_SYNC_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("INSTRUCTOR_SYNC_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, instructorNotionSource: dependencies.source });
    return await runtime.run(work);
  } catch { throw new Error("INSTRUCTOR_SYNC_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
