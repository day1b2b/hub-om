import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { getOmCustomToolsRepository } from "./omRequest/omCustomToolsLocalRepository";
import type { OmCustomToolsRepository } from "./omRequest/omRequestRepository";
import { openMongoOperationPagesRuntime } from "./mongoOperationPagesRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface OmRequestPagesCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  getCustomTools(): OmCustomToolsRepository;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; omCustomTools: OmCustomToolsRepository }): Promise<Runtime>;
}
const defaults: OmRequestPagesCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  getCustomTools: getOmCustomToolsRepository,
  openRuntime: input => openMongoOperationPagesRuntime({ ...input, client: input.client as MongoClient })
};
function isNextControlFlow(error: unknown) {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest));
}
function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_:\- ]{1,160}$/.test(message) ? message : "REDACTED";
}
export async function runOmRequestPagesRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: OmRequestPagesCompositionDependencies = defaults): Promise<T> {
  const backend = environment.OM_REQUEST_PAGES_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("OM_REQUEST_PAGES_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, omCustomTools: dependencies.getCustomTools() });
    return await runtime.run(work);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error("OM_REQUEST_PAGES_COMPOSITION_FAILED", safeFailureCode(error));
    throw new Error("OM_REQUEST_PAGES_COMPOSITION_FAILED");
  } finally { if (client) try { await client.close(); } catch {} }
}
