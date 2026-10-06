import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoSatisfactionDryRunRuntime } from "./mongoSatisfactionDryRunRuntime";
import { runSatisfactionDryRunCommand } from "./satisfactionDryRunCommand";
type Environment = Record<string, string | undefined>; const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; } interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
interface Dependencies { createClient(env: Environment): Client; openRuntime(input: { client: Client; databaseName: string; namespace: string }): Promise<Runtime>; runCommand: typeof runSatisfactionDryRunCommand; }
const defaults: Dependencies = { createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()), openRuntime: input => openMongoSatisfactionDryRunRuntime({ ...input, client: input.client as MongoClient }), runCommand: runSatisfactionDryRunCommand };
export async function runSatisfactionDryRunCli(args: string[], env: Environment, loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  loadEnvironment();
  const selectors = args.filter(value => value.startsWith("--backend=")); if (!selectors.length) return dependencies.runCommand(args, () => {});
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("SATISFACTION_DRY_RUN_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? ""; if (!namespacePattern.test(namespace)) throw new Error("SATISFACTION_DRY_RUN_FAILED");
  let client: Client | undefined, result: Awaited<ReturnType<typeof runSatisfactionDryRunCommand>> | undefined, failed = false, cleanupFailed = false;
  try { client = dependencies.createClient(env); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace }); result = await runtime.run(() => dependencies.runCommand(args.filter(value => !value.startsWith("--backend=")), () => { throw new Error("SATISFACTION_DRY_RUN_FAILED"); })); }
  catch { failed = true; } finally { if (client) try { await client.close(); } catch { cleanupFailed = true; } }
  if (cleanupFailed) throw new Error(result ? "SATISFACTION_DRY_RUN_CLEANUP_FAILED" : "SATISFACTION_DRY_RUN_FAILED"); if (failed || !result) throw new Error("SATISFACTION_DRY_RUN_FAILED"); return result;
}
