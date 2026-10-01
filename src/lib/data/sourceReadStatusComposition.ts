import { timingSafeEqual } from "node:crypto";
import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { getOperationSourceReader } from "../sourceReads/sourceReaderFactory";
import type { OperationSourceReader } from "../sourceReads/sourceReadTypes";
import { openMongoSourceReadStatusRuntime } from "./mongoSourceReadStatusRuntime";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;

function decodeCanonicalKey(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value ? decoded : null;
}

function assertPrivacyEnvironment(env: Environment): void {
  const active = env.PII_ACTIVE_KEY_ID?.trim() ?? "";
  let values: unknown;
  try { values = JSON.parse(env.PII_ENCRYPTION_KEYS ?? ""); }
  catch { throw new Error("privacy"); }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(active) || !values || typeof values !== "object" || Array.isArray(values)) throw new Error("privacy");
  const activeKey = decodeCanonicalKey((values as Record<string, unknown>)[active]);
  const indexKey = decodeCanonicalKey(env.PII_INDEX_KEY);
  if (!activeKey || !indexKey || timingSafeEqual(activeKey, indexKey)) throw new Error("privacy");
}

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

  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("SOURCE_READ_STATUS_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    assertPrivacyEnvironment(env);
    configuredMongoUri(env);
    const databaseName = shadowDatabaseName(env);
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
