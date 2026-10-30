import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition } from "./mongoShadowComposition";
import { openMongoOperationWriteRuntime } from "./mongoOperationWriteRuntime";
import { runMergeCourseAndRoundNotesCommand, type MergeCourseAndRoundNotesSummary } from "./mergeCourseAndRoundNotesCommand";

type Environment = Record<string, string | undefined>;

export async function runMergeCourseAndRoundNotesCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void
): Promise<MergeCourseAndRoundNotesSummary> {
  const backendArgs = args.filter((value) => value.startsWith("--backend="));
  if (backendArgs.length === 0) return runMergeCourseAndRoundNotesCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("MERGE_COURSE_AND_ROUND_NOTES_FAILED");

  const { databaseName, namespace } = requireMongoShadowComposition(env);
  const client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
  let result: MergeCourseAndRoundNotesSummary | undefined;
  let failed = false;
  try {
    await client.connect();
    const runtime = await openMongoOperationWriteRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    result = await runtime.run(() => runMergeCourseAndRoundNotesCommand(
      args.filter((value) => !value.startsWith("--backend=")),
      () => { throw new Error("MERGE_COURSE_AND_ROUND_NOTES_FAILED"); }
    ));
  } catch { failed = true; }
  finally { try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("MERGE_COURSE_AND_ROUND_NOTES_FAILED");
  return result;
}
