import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { runCoachDataVerificationCommand } from "./coachDataVerificationCommand";
import { openMongoCoachDataVerificationRuntime } from "./mongoCoachDataVerificationRuntime";
type Environment = Record<string, string | undefined>; const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
interface Dependencies { createClient(env: Environment): Client; openRuntime(input: { client: Client; databaseName: string; namespace: string }): Promise<Runtime>; runCommand: typeof runCoachDataVerificationCommand; }
const defaults: Dependencies = { createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachDataVerificationRuntime({ ...input, client: input.client as MongoClient }), runCommand: runCoachDataVerificationCommand };
export async function runCoachDataVerificationCli(args: string[], env: Environment, loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const selectors = args.filter(arg => arg.startsWith("--backend="));
  if (!selectors.length) return dependencies.runCommand(args, loadEnvironment);
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("COACH_DATA_VERIFICATION_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? ""; if (!namespacePattern.test(namespace)) throw new Error("COACH_DATA_VERIFICATION_FAILED");
  let client: Client | undefined, result: Awaited<ReturnType<typeof runCoachDataVerificationCommand>> | undefined, failed = false;
  try { client = dependencies.createClient(env); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace });
    result = await runtime.run(() => dependencies.runCommand(args.filter(arg => !arg.startsWith("--backend=")), () => { throw new Error("COACH_DATA_VERIFICATION_FAILED"); })); }
  catch { failed = true; } finally { if (client) try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COACH_DATA_VERIFICATION_FAILED"); return result;
}
