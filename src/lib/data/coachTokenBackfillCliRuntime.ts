import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { runCoachTokenBackfillCommand } from "./coachTokenBackfillCommand";
import { openMongoCoachTokenBackfillRuntime } from "./mongoCoachTokenBackfillRuntime";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T>; }
export interface CoachTokenBackfillCliDependencies {
  createClient(env: Environment): Client;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>;
  runCommand: typeof runCoachTokenBackfillCommand;
}
const defaults: CoachTokenBackfillCliDependencies = {
  createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()),
  openRuntime: input => openMongoCoachTokenBackfillRuntime({ ...input, client: input.client as MongoClient }),
  runCommand: runCoachTokenBackfillCommand,
};

/** PostgreSQL remains the default. Mongo requires one exact selector and a prepared shadow namespace. */
export async function runCoachTokenBackfillCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
  dependencies: CoachTokenBackfillCliDependencies = defaults,
) {
  const selectors = args.filter(value => value.startsWith("--backend="));
  if (!selectors.length) return dependencies.runCommand(args, loadDefaultEnvironment);
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("COACH_TOKEN_BACKFILL_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? "";
  if (!namespacePattern.test(namespace)) throw new Error("COACH_TOKEN_BACKFILL_FAILED");
  const commandArgs = args.filter(value => !value.startsWith("--backend="));
  let client: Client | undefined;
  let result: Awaited<ReturnType<typeof runCoachTokenBackfillCommand>> | undefined;
  let failed = false;
  try {
    client = dependencies.createClient(env);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(commandArgs, () => { throw new Error("COACH_TOKEN_BACKFILL_FAILED"); }));
  } catch { failed = true; }
  finally { if (client) try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COACH_TOKEN_BACKFILL_FAILED");
  return result;
}
