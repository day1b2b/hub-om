import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { getOperationSourceReader } from "../sourceReads/sourceReaderFactory";
import type { OperationSourceReader } from "../sourceReads/sourceReadTypes";
import { openMongoSourceReadStatusRuntime } from "./mongoSourceReadStatusRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

type Environment = MongoCompositionEnvironment;

interface Client {
  connect(): Promise<unknown>;
  close(): Promise<void>;
}
interface Runtime {
  run<T>(work: () => Promise<T>): Promise<T>;
}
export interface SourceReadStatusCompositionDependencies {
  createClient(env: Environment): Client;
  getSourceReader(): Promise<OperationSourceReader>;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; operationSourceReader: OperationSourceReader }): Promise<Runtime>;
}

const defaults: SourceReadStatusCompositionDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  getSourceReader: getOperationSourceReader,
  openRuntime: input => openMongoSourceReadStatusRuntime({ ...input, client: input.client as MongoClient })
};

/** Default remains PostgreSQL. The exact Mongo selector only opens an already prepared shadow namespace. */
export async function runSourceReadStatusRequest<T>(
  work: () => Promise<T>,
  env: Environment = process.env,
  dependencies: SourceReadStatusCompositionDependencies = defaults
): Promise<T> {
  const backend = env.SOURCE_READ_STATUS_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("SOURCE_READ_STATUS_COMPOSITION_FAILED");

  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(env);
    const operationSourceReader = await dependencies.getSourceReader();
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({
      client,
      databaseName,
      namespace,
      allowShadowWrites: true,
      operationSourceReader
    });
    return await runtime.run(work);
  } catch {
    throw new Error("SOURCE_READ_STATUS_COMPOSITION_FAILED");
  } finally {
    if (client) {
      try { await client.close(); }
      catch { /* A cleanup failure must not turn an already audited response into a different result. */ }
    }
  }
}
