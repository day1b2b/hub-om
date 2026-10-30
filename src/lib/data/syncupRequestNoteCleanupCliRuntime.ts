import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition } from "./mongoShadowComposition";
import { openMongoOperationWriteRuntime } from "./mongoOperationWriteRuntime";
import { runSyncupRequestNoteCleanupCommand, type SyncupRequestNoteCleanupSummary } from "./syncupRequestNoteCleanupCommand";

type Environment = Record<string, string | undefined>;

export async function runSyncupRequestNoteCleanupCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
): Promise<SyncupRequestNoteCleanupSummary> {
  const backendArgs = args.filter(value => value.startsWith("--backend="));
  if (backendArgs.length === 0) return runSyncupRequestNoteCleanupCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("SYNCUP_CLEANUP_FAILED");

  const { databaseName, namespace } = requireMongoShadowComposition(env);
  const client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
  let result: SyncupRequestNoteCleanupSummary | undefined;
  let failed = false;
  try {
    await client.connect();
    const runtime = await openMongoOperationWriteRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    result = await runtime.run(() => runSyncupRequestNoteCleanupCommand(
      args.filter(value => !value.startsWith("--backend=")),
      () => { throw new Error("SYNCUP_CLEANUP_FAILED"); },
    ));
  } catch { failed = true; }
  finally { try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("SYNCUP_CLEANUP_FAILED");
  return result;
}
