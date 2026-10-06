import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCoachOperationsRuntime } from "./mongoCoachOperationsRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface CoachOperationsCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}
const defaults: CoachOperationsCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachOperationsRuntime({ ...input, client: input.client as MongoClient })
};
export async function runCoachOperationsRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: CoachOperationsCompositionDependencies = defaults): Promise<T> {
  const backend = environment.COACH_OPERATIONS_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("COACH_OPERATIONS_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch (error) {
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest))) throw error;
    throw new Error("COACH_OPERATIONS_COMPOSITION_FAILED");
  } finally { if (client) try { await client.close(); } catch {} }
}
