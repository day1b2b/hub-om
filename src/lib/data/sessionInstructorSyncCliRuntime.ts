import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoSessionInstructorSyncRuntime } from "./mongoSessionInstructorSyncRuntime";

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
  openRuntime: input => openMongoSessionInstructorSyncRuntime({ ...input, client: input.client as MongoClient })
};

/** PostgreSQL이 기본. Mongo는 정확한 선택자 하나와 이미 준비된 섀도 네임스페이스를 요구한다. */
export async function runSessionInstructorSyncCli<T>(
  args: string[], env: Environment, command: (args: string[], loadEnvironment: () => void) => Promise<T>, loadEnvironment: () => void,
  dependencies: Dependencies = defaults
): Promise<T> {
  const backend = args.filter(value => value.startsWith("--backend="));
  if (!backend.length) return command(args, loadEnvironment);
  if (backend.length !== 1 || backend[0] !== "--backend=mongodb-shadow") throw new Error("SESSION_INSTRUCTOR_SYNC_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("SESSION_INSTRUCTOR_SYNC_FAILED");
  let client: OwnedClient | undefined, result: T | undefined, failed = false;
  try {
    client = dependencies.createClient(env); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => command(args.filter(value => !value.startsWith("--backend=")), () => { throw new Error("SESSION_INSTRUCTOR_SYNC_FAILED"); }));
  } catch { failed = true; }
  finally { if (client) try { await client.close(); } catch { failed = true; } }
  if (failed || result === undefined) throw new Error("SESSION_INSTRUCTOR_SYNC_FAILED");
  return result;
}
