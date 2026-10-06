import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoAdminMaintenanceRuntime } from "./mongoAdminMaintenanceRuntime";
import { runOnsiteRequiredBackfillCommand, type OnsiteRequiredBackfillSummary } from "./onsiteRequiredBackfillCommand";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface OwnedMongoClient { connect(): Promise<unknown>; close(): Promise<void>; }
interface MongoRuntimeRunner { run<T>(callback: () => Promise<T>): Promise<T>; }
interface Dependencies {
  createClient(env: Environment): OwnedMongoClient;
  openRuntime(input: { client: OwnedMongoClient; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<MongoRuntimeRunner>;
  runCommand: typeof runOnsiteRequiredBackfillCommand;
}
const defaults: Dependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoAdminMaintenanceRuntime({ ...input, client: input.client as MongoClient }),
  runCommand: runOnsiteRequiredBackfillCommand,
};

/** PostgreSQL stays the default. Mongo requires one explicit selector and a prepared shadow. */
export async function runOnsiteRequiredBackfillCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
  dependencies: Dependencies = defaults,
): Promise<OnsiteRequiredBackfillSummary> {
  const backendArgs = args.filter(value => value.startsWith("--backend="));
  if (backendArgs.length === 0) return dependencies.runCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("ONSITE_REQUIRED_BACKFILL_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("ONSITE_REQUIRED_BACKFILL_FAILED");
  const commandArgs = args.filter(value => !value.startsWith("--backend="));
  let client: OwnedMongoClient | undefined, result: OnsiteRequiredBackfillSummary | undefined, failed = false;
  try {
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(commandArgs, () => { throw new Error("ONSITE_REQUIRED_BACKFILL_FAILED"); }));
  } catch { failed = true; }
  finally { if (client) { try { await client.close(); } catch { failed = true; } } }
  if (failed || !result) throw new Error("ONSITE_REQUIRED_BACKFILL_FAILED");
  return result;
}
