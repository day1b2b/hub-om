import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { readDefaultSatisfactionRows } from "./satisfactionDefaultSource";
import { openMongoSatisfactionRuntime } from "./mongoSatisfactionRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
import type { SatisfactionSource } from "./satisfactionSource";
interface Client { connect(): Promise<unknown>; close(): Promise<void> } interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface SatisfactionCompositionDependencies { createClient(environment: MongoCompositionEnvironment): Client; source: SatisfactionSource; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; satisfactionSource: SatisfactionSource }): Promise<Runtime> }
const defaults: SatisfactionCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  source: Object.freeze({ readRows: readDefaultSatisfactionRows }),
  openRuntime: input => openMongoSatisfactionRuntime({ ...input, client: input.client as MongoClient })
};
export async function runSatisfactionRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: SatisfactionCompositionDependencies = defaults): Promise<T> {
  const backend = environment.SATISFACTION_BACKEND?.trim() || "postgres"; if (backend === "postgres") return work(); if (backend !== "mongodb-shadow") throw new Error("SATISFACTION_COMPOSITION_FAILED"); let client: Client | undefined;
  try { const { databaseName, namespace } = requireMongoShadowComposition(environment); client = dependencies.createClient(environment); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, satisfactionSource: dependencies.source }); return await runtime.run(work); }
  catch { throw new Error("SATISFACTION_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
