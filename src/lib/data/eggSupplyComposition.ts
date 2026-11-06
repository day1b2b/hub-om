import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { openMongoEggRuntime, openMongoSupplyRuntime } from "./mongoEggSupplyRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
type OpenInput = { client: Client; databaseName: string; namespace: string; allowShadowWrites: true };
export interface EggSupplyCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: OpenInput): Promise<Runtime>;
}
const createClient = (environment: MongoCompositionEnvironment) => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions());
const eggDefaults: EggSupplyCompositionDependencies = {
  createClient, openRuntime: input => openMongoEggRuntime({ ...input, client: input.client as MongoClient })
};
const supplyDefaults: EggSupplyCompositionDependencies = {
  createClient, openRuntime: input => openMongoSupplyRuntime({ ...input, client: input.client as MongoClient })
};

/**
 * 에그·물품은 운영 화면의 일부라 OPERATION_PAGES_BACKEND를 따른다(새 selector 없음).
 * 운영에서 모든 selector는 같은 값이어야 한다(mongoDeploymentCheck).
 */
async function runRequest<T>(failure: string, work: () => Promise<T>, environment: MongoCompositionEnvironment, dependencies: EggSupplyCompositionDependencies): Promise<T> {
  const backend = environment.OPERATION_PAGES_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error(failure);
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    return await runtime.run(work);
  } catch (error) {
    const digest = error instanceof Error ? (error as Error & { digest?: unknown }).digest : undefined;
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404" || (typeof digest === "string" && /^NEXT_REDIRECT;(?:replace|push);.*;(?:303|307|308);$/.test(digest))) throw error;
    throw new Error(failure);
  } finally { if (client) try { await client.close(); } catch {} }
}

export function runEggRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: EggSupplyCompositionDependencies = eggDefaults): Promise<T> {
  return runRequest("EGG_COMPOSITION_FAILED", work, environment, dependencies);
}

export function runSupplyRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: EggSupplyCompositionDependencies = supplyDefaults): Promise<T> {
  return runRequest("SUPPLY_COMPOSITION_FAILED", work, environment, dependencies);
}
