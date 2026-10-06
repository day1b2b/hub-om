import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoOmRequestWriteRuntime } from "./mongoOmRequestWriteRuntime";
import { getOmAssignmentCalendar, getOmAssignmentNotifier } from "./omRequest/omAssignmentEffects";
import { getOmCustomToolsRepository } from "./omRequest/omCustomToolsLocalRepository";
import { getOmRequestNotifier } from "./omRequest/omRequestRepositoryFactory";
import type { OmAssignmentCalendar, OmAssignmentNotifier } from "./omRequest/omAssignmentEffects";
import type { OmCustomToolsRepository, OmRequestNotifier } from "./omRequest/omRequestRepository";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface OmRequestWriteCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  getPorts(): { omAssignmentCalendar: OmAssignmentCalendar; omAssignmentNotifier: OmAssignmentNotifier; omCustomTools: OmCustomToolsRepository; omRequestNotifier: OmRequestNotifier };
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; omAssignmentCalendar: OmAssignmentCalendar; omAssignmentNotifier: OmAssignmentNotifier; omCustomTools: OmCustomToolsRepository; omRequestNotifier: OmRequestNotifier }): Promise<Runtime>;
}
const defaults: OmRequestWriteCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  getPorts: () => ({ omAssignmentCalendar: getOmAssignmentCalendar(), omAssignmentNotifier: getOmAssignmentNotifier(), omCustomTools: getOmCustomToolsRepository(), omRequestNotifier: getOmRequestNotifier() }),
  openRuntime: input => openMongoOmRequestWriteRuntime({ ...input, client: input.client as MongoClient })
};
function isNextControlFlow(error: unknown) {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest));
}
function safeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "UNKNOWN";
}
export async function runOmRequestWriteRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: OmRequestWriteCompositionDependencies = defaults): Promise<T> {
  const backend = environment.OM_REQUEST_WRITE_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("OM_REQUEST_WRITE_COMPOSITION_FAILED");
  let client: Client | undefined;
  let stage = "configuration";
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    stage = "ports";
    const ports = dependencies.getPorts();
    stage = "connect";
    client = dependencies.createClient(environment); await client.connect();
    stage = "open";
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, ...ports });
    stage = "work";
    return await runtime.run(work);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error(`[om-request] OM_REQUEST_WRITE_COMPOSITION_FAILED stage=${stage} cause=${safeCode(error)}`);
    throw new Error("OM_REQUEST_WRITE_COMPOSITION_FAILED");
  }
  finally { if (client) try { await client.close(); } catch {} }
}
