import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoSourceOnlyPromotionRuntime } from "./mongoSourceOnlyPromotionRuntime";
import { runSourceOnlyPromotionCommand } from "./sourceOnlyPromotionCommand";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
interface Dependencies {
  createClient(env: Environment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
  runCommand: typeof runSourceOnlyPromotionCommand;
}
const defaults: Dependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoSourceOnlyPromotionRuntime({ ...input, client: input.client as MongoClient }),
  runCommand: runSourceOnlyPromotionCommand
};

export async function runSourceOnlyPromotionCli(args: string[], env: Environment, loadEnvironment: () => void, dependencies: Dependencies = defaults) {
  const selectors = args.filter(arg => arg.startsWith("--backend="));
  if (!selectors.length) return dependencies.runCommand(args, loadEnvironment);
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  let client: Client | undefined;
  let result: Awaited<ReturnType<typeof runSourceOnlyPromotionCommand>> | undefined;
  let failed = false;
  let completed = false;
  let cleanupFailed = false;
  try {
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(args.filter(arg => !arg.startsWith("--backend=")), () => {
      throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
    }));
    completed = true;
  } catch { failed = true; }
  finally { if (client) try { await client.close(); } catch { cleanupFailed = true; } }
  if (completed && cleanupFailed) throw new Error("SOURCE_ONLY_PROMOTION_CLEANUP_FAILED");
  if (cleanupFailed) failed = true;
  if (failed || !result) throw new Error("SOURCE_ONLY_PROMOTION_FAILED");
  return result;
}
