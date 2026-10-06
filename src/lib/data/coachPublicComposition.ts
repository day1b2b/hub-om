import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCoachPublicRuntime } from "./mongoCoachPublicRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface CoachPublicCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}
const defaults: CoachPublicCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachPublicRuntime({ ...input, client: input.client as MongoClient })
};
function isNextControlFlow(error: unknown) {
  const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
  return digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest));
}
export async function runCoachPublicRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: CoachPublicCompositionDependencies = defaults): Promise<T> {
  const backend = environment.COACH_PUBLIC_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("COACH_PUBLIC_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    throw new Error("COACH_PUBLIC_COMPOSITION_FAILED");
  } finally {
    if (client) try { await client.close(); } catch {}
  }
}
