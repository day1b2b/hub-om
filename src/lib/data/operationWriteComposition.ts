import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoOperationWriteRuntime } from "./mongoOperationWriteRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
interface Client { connect(): Promise<unknown>; close(): Promise<void> } interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface OperationWriteCompositionDependencies { createClient(environment: MongoCompositionEnvironment): Client; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime> }
const defaults: OperationWriteCompositionDependencies = { createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()), openRuntime: input => openMongoOperationWriteRuntime({ ...input, client: input.client as MongoClient }) };
function safeCode(error: unknown): string { const message=error instanceof Error?error.message:""; return /^[A-Z][A-Z0-9_]{2,80}$/.test(message)?message:"UNKNOWN"; }
export async function runOperationWriteRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: OperationWriteCompositionDependencies = defaults): Promise<T> {
  const backend = environment.OPERATION_WRITE_BACKEND?.trim() || "postgres"; if (backend === "postgres") return work(); if (backend !== "mongodb-shadow") throw new Error("OPERATION_WRITE_COMPOSITION_FAILED"); let client: Client | undefined; let stage="configuration";
  try { const { databaseName, namespace } = requireMongoShadowComposition(environment); stage="connect"; client = dependencies.createClient(environment); await client.connect(); stage="open"; const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true }); stage="work"; return await runtime.run(work); }
  catch (error) { const digest=error instanceof Error?(error as Error&{digest?:unknown}).digest:undefined; if(digest==="NEXT_HTTP_ERROR_FALLBACK;404"||(typeof digest==="string"&&/^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest)))throw error; console.error(`[operations] OPERATION_WRITE_COMPOSITION_FAILED stage=${stage} cause=${safeCode(error)}`); throw new Error("OPERATION_WRITE_COMPOSITION_FAILED"); } finally { if (client) try { await client.close(); } catch {} }
}
