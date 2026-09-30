import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions, shadowDatabaseName } from "../mongodb/connection";
import { openMongoUserAdminRuntime } from "./mongoUserAdminRuntime";
import { runTeamLabelBackfillCommand, type TeamLabelBackfillSummary } from "./teamLabelBackfillCommand";

type Environment = Record<string, string | undefined>;
const namespacePattern = /^shadow_[A-Za-z0-9_-]{1,80}$/;
interface Client { connect(): Promise<unknown>; close(): Promise<void>; }
interface Runtime { run<T>(callback: () => Promise<T>): Promise<T>; }
interface Dependencies { createClient(env: Environment): Client; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true }): Promise<Runtime>; runCommand: typeof runTeamLabelBackfillCommand; }
const defaults: Dependencies = { createClient: env => new MongoClient(configuredMongoUri(env), mongoConnectionOptions()), openRuntime: input => openMongoUserAdminRuntime({ ...input, client: input.client as MongoClient }), runCommand: runTeamLabelBackfillCommand };

export async function runTeamLabelBackfillCli(args: string[], env: Environment, loadDefaultEnvironment: () => void, dependencies: Dependencies = defaults): Promise<TeamLabelBackfillSummary> {
  const selectors = args.filter(value => value.startsWith("--backend="));
  if (selectors.length === 0) return dependencies.runCommand(args, env, loadDefaultEnvironment);
  if (selectors.length !== 1 || selectors[0] !== "--backend=mongodb-shadow") throw new Error("TEAM_LABEL_BACKFILL_FAILED");
  const namespace = env.MONGODB_SHADOW_NAMESPACE?.trim() ?? ""; if (!namespacePattern.test(namespace)) throw new Error("TEAM_LABEL_BACKFILL_FAILED");
  const commandArgs = args.filter(value => !value.startsWith("--backend=")); let client: Client | undefined, result: TeamLabelBackfillSummary | undefined, failed = false;
  try {
    client = dependencies.createClient(env); await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName: shadowDatabaseName(env), namespace, allowShadowWrites: true });
    result = await runtime.run(() => dependencies.runCommand(commandArgs, env, () => { throw new Error("TEAM_LABEL_BACKFILL_FAILED"); }));
  } catch { failed = true; }
  finally { if (client) { try { await client.close(); } catch { failed = true; } } }
  if (failed || !result) throw new Error("TEAM_LABEL_BACKFILL_FAILED"); return result;
}
