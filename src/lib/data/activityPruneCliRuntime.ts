import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoOperationalRuntime } from "./mongoOperationalRuntime";
import { runActivityPruneCommand, type ActivityPruneSummary } from "./activityPruneCommand";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;

interface OwnedMongoClient {
  connect(): Promise<unknown>;
  close(): Promise<void>;
}

interface MongoRuntimeRunner {
  run<T>(callback: () => Promise<T>): Promise<T>;
}

interface ActivityPruneCliDependencies {
  createClient(env: Environment): OwnedMongoClient;
  openRuntime(input: { client: OwnedMongoClient; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<MongoRuntimeRunner>;
  runCommand: typeof runActivityPruneCommand;
}

const defaultDependencies: ActivityPruneCliDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoOperationalRuntime({ ...input, client: input.client as MongoClient }),
  runCommand: runActivityPruneCommand,
};

/** Default invocation remains PostgreSQL. Mongo requires an exact flag and explicit prepared shadow coordinates. */
export async function runActivityPruneCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
  writeSummary: (summary: ActivityPruneSummary) => void = () => {},
  dependencies: ActivityPruneCliDependencies = defaultDependencies,
): Promise<ActivityPruneSummary> {
  const mongoSelected = args.length === 1 && args[0] === "--backend=mongodb-shadow";
  if (!mongoSelected) {
    if (args.some(value => value.startsWith("--backend="))) throw new Error("ACTIVITY_PRUNE_FAILED");
    // Preserve the legacy command's ignored arguments; only the new backend option is interpreted.
    return dependencies.runCommand(loadDefaultEnvironment, writeSummary);
  }
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("ACTIVITY_PRUNE_FAILED");
  let client: OwnedMongoClient | undefined;
  let result: ActivityPruneSummary | undefined, failed = false;
  try {
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(() => { throw new Error("ACTIVITY_PRUNE_FAILED"); }, writeSummary));
  } catch { failed = true; }
  finally { if (client) { try { await client.close(); } catch { failed = true; } } }
  if (failed || !result) throw new Error("ACTIVITY_PRUNE_FAILED");
  return result;
}
