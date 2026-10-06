import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoOperationImportRuntime } from "./mongoOperationImportRuntime";
import { runOperationImportCommand } from "./operationImportCommand";
type Environment = Record<string, string | undefined>; const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; } interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
interface Dependencies { createClient(env: Environment): Client; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>; runCommand: typeof runOperationImportCommand; }
const defaults: Dependencies = { createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()), openRuntime: input => openMongoOperationImportRuntime({ ...input, client: input.client as MongoClient }), runCommand: runOperationImportCommand };
export async function runOperationImportCli(args: string[], env: Environment, loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const selectors = args.filter(arg => arg.startsWith("--backend=")); if (!selectors.length) return dependencies.runCommand(args, env, loadEnvironment);
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("OPERATION_IMPORT_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? ""; if (!namespacePattern.test(namespace)) throw new Error("OPERATION_IMPORT_FAILED");
  let client: Client | undefined, result: Awaited<ReturnType<typeof runOperationImportCommand>> | undefined, failed = false, completed = false, cleanupFailed = false;
  try { client = dependencies.createClient(env); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(args.filter(arg => !arg.startsWith("--backend=")), env, () => { throw new Error("OPERATION_IMPORT_FAILED"); })); completed = true;
  } catch { failed = true; } finally { if (client) try { await client.close(); } catch { cleanupFailed = true; } }
  if (completed && cleanupFailed) throw new Error("OPERATION_IMPORT_CLEANUP_FAILED");
  if (failed || cleanupFailed || !result) throw new Error("OPERATION_IMPORT_FAILED"); return result;
}
