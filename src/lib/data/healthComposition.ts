import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import {
  requireMongoShadowComposition,
  type MongoCompositionEnvironment
} from "./mongoShadowComposition";
import { openMongoHealthRuntime } from "./mongoHealthRuntime";

interface Client {
  connect(): Promise<unknown>;
  close(): Promise<void>;
}

interface Runtime {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface HealthCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string }): Runtime;
}

const defaults: HealthCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  openRuntime: input => openMongoHealthRuntime({ ...input, client: input.client as MongoClient })
};

export async function runHealthRequest<T>(
  work: () => Promise<T>,
  environment: MongoCompositionEnvironment = process.env,
  dependencies: HealthCompositionDependencies = defaults
): Promise<T> {
  const backend = environment.HEALTH_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("HEALTH_COMPOSITION_FAILED");

  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = dependencies.openRuntime({ client, databaseName, namespace });
    return await runtime.run(work);
  } catch {
    throw new Error("HEALTH_COMPOSITION_FAILED");
  } finally {
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
