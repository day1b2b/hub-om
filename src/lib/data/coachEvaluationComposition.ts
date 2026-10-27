import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoCoachEvaluationRuntime } from "./mongoCoachEvaluationRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface CoachEvaluationCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
}
const defaults: CoachEvaluationCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachEvaluationRuntime({ ...input, client: input.client as MongoClient })
};
/**
 * 코치 평가는 코치 관리 기능의 일부라 COACH_MANAGEMENT_BACKEND를 따른다(새 selector 없음).
 * 운영에서 모든 selector는 같은 값이어야 한다(mongoDeploymentCheck).
 */
export async function runCoachEvaluationRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: CoachEvaluationCompositionDependencies = defaults): Promise<T> {
  const backend = environment.COACH_MANAGEMENT_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("COACH_EVALUATION_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch (error) {
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest))) throw error;
    throw new Error("COACH_EVALUATION_COMPOSITION_FAILED");
  } finally { if (client) try { await client.close(); } catch {} }
}
