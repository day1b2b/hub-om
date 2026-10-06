import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoCoachOperationMatchRuntime } from "./mongoCoachOperationMatchRuntime";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface OwnedClient { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runner { run<T>(work: () => Promise<T>): Promise<T>; }
interface Dependencies {
  createClient(env: Environment): OwnedClient;
  openRuntime(input: { client: OwnedClient; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runner>;
}
const defaults: Dependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachOperationMatchRuntime({ ...input, client: input.client as MongoClient })
};

/** PostgreSQL remains default; Mongo requires one exact selector and an already prepared shadow namespace. */
export async function runCoachOperationMatchCli<T>(
  args: string[], env: Environment, command: (args: string[], loadEnvironment: () => void) => Promise<T>, loadEnvironment: () => void,
  dependencies: Dependencies = defaults
): Promise<T> {
  const backend = args.filter(value => value.startsWith("--backend="));
  if (!backend.length) return command(args, loadEnvironment);
  if (backend.length !== 1 || backend[0] !== "--backend=mongodb-shadow") throw new Error("COACH_OPERATION_MATCH_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("COACH_OPERATION_MATCH_FAILED");
  let client: OwnedClient | undefined, result: T | undefined, failed = false;
  try {
    client = dependencies.createClient(env); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => command(args.filter(value => !value.startsWith("--backend=")), () => { throw new Error("COACH_OPERATION_MATCH_FAILED"); }));
  } catch { failed = true; }
  finally { if (client) try { await client.close(); } catch { failed = true; } }
  if (failed || result === undefined) throw new Error("COACH_OPERATION_MATCH_FAILED");
  return result;
}
