import { MongoClient } from "mongodb";

/** No eager client creation: adding MONGODB_URI never changes the production data source. */
export function mongoConnectionOptions() {
  return { appName: "hub-om-shadow-validation", serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 15000, maxPoolSize: 4, minPoolSize: 0, retryWrites: false, monitorCommands: false };
}
export class MongoPreparationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "MongoPreparationError"; }
}
export function configuredMongoUri(env: Record<string, string | undefined> = process.env): string {
  const uri = env.MONGODB_URI?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new MongoPreparationError("MONGODB_URI_MISSING_OR_INVALID");
  return uri;
}

/** Production databases: "hub-om" is the target, "hub-om-shadow-validation" is the current (transitional) production database. */
export const PRODUCTION_MONGO_DATABASES: readonly string[] = Object.freeze(["hub-om", "hub-om-shadow-validation"]);
const TEST_MONGO_DATABASE = /^hub_om_shadow_[a-z0-9_]{1,40}$/;
export type MongoDatabaseRole = "production" | "test";

export function mongoDatabaseRoleOf(name: string): MongoDatabaseRole | undefined {
  if (PRODUCTION_MONGO_DATABASES.includes(name)) return "production";
  return TEST_MONGO_DATABASE.test(name) ? "test" : undefined;
}

/** Test tools must call this: production databases are rejected regardless of env. */
export function assertTestMongoDatabase(name: string): string {
  if (mongoDatabaseRoleOf(name) !== "test") throw new MongoPreparationError("PRODUCTION_DATABASE_REJECTED_FOR_TEST");
  return name;
}

/**
 * MONGODB_DATABASE_ROLE makes the target explicit:
 * - "production": only a production database
 * - "test": only a synthetic test database (production is rejected)
 * - unset: legacy behaviour (hub-om-shadow-validation or a test database), so existing containers keep working.
 */
export function shadowDatabaseName(env: Record<string, string | undefined> = process.env): string {
  const name = env.MONGODB_SHADOW_DATABASE;
  const role = env.MONGODB_DATABASE_ROLE?.trim() || undefined;
  if (role !== undefined && role !== "production" && role !== "test") throw new MongoPreparationError("MONGODB_DATABASE_ROLE_INVALID");
  const actual = name ? mongoDatabaseRoleOf(name) : undefined;
  if (role === "test" && actual === "production") throw new MongoPreparationError("PRODUCTION_DATABASE_REJECTED_FOR_TEST");
  const allowed = role ? actual === role : name === "hub-om-shadow-validation" || actual === "test";
  if (!name || !allowed) throw new MongoPreparationError("EXPLICIT_SHADOW_DATABASE_REQUIRED");
  // No URI default database fallback, so diagnostics can never select an existing production DB for writes.
  return name;
}

type DiagnosticClient = {
  connect(): Promise<unknown>;
  db(name: string): { command(command: Record<string, unknown>): Promise<Record<string, unknown>> };
  close(): Promise<unknown>;
};
export type MongoReadiness = {
  connected: true;
  topology: "replica-set" | "sharded" | "standalone";
  transactionsAdvertised: boolean;
  writesPerformed: false;
  readyForCutover: false;
};

/** Read-only hello/ping only. Never returns hosts, URI, credentials or raw driver errors. */
export async function diagnoseMongoConnection(
  env: Record<string, string | undefined> = process.env,
  factory: (uri: string) => DiagnosticClient = uri => new MongoClient(uri, mongoConnectionOptions()),
): Promise<MongoReadiness> {
  const uri = configuredMongoUri(env);
  let client: DiagnosticClient | undefined;
  try {
    client = factory(uri);
    await client.connect();
    const admin = client.db("admin");
    await admin.command({ ping: 1 });
    const hello = await admin.command({ hello: 1 });
    const topology = typeof hello.setName === "string" ? "replica-set" : hello.msg === "isdbgrid" ? "sharded" : "standalone";
    return { connected: true, topology, transactionsAdvertised: topology !== "standalone" && typeof hello.logicalSessionTimeoutMinutes === "number" && typeof hello.maxWireVersion === "number" && hello.maxWireVersion >= (topology === "sharded" ? 8 : 7), writesPerformed: false, readyForCutover: false };
  } catch { throw new MongoPreparationError("MONGODB_CONNECTION_CHECK_FAILED"); }
  finally { if (client) { try { await client.close(); } catch { /* Do not disclose raw errors. */ } } }
}
