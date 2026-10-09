import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition } from "./mongoShadowComposition";
import { openMongoOperationWriteRuntime } from "./mongoOperationWriteRuntime";
import { runCourseCommonNoteBackfillCommand, type CourseCommonNoteBackfillSummary } from "./courseCommonNoteBackfillCommand";

type Environment = Record<string, string | undefined>;

export async function runCourseCommonNoteBackfillCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
): Promise<CourseCommonNoteBackfillSummary> {
  const backendArgs = args.filter(value => value.startsWith("--backend="));
  if (backendArgs.length === 0) return runCourseCommonNoteBackfillCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("COURSE_COMMON_NOTE_BACKFILL_FAILED");

  const { databaseName, namespace } = requireMongoShadowComposition(env);
  const client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
  let result: CourseCommonNoteBackfillSummary | undefined;
  let failed = false;
  try {
    await client.connect();
    const runtime = await openMongoOperationWriteRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    result = await runtime.run(() => runCourseCommonNoteBackfillCommand(
      args.filter(value => !value.startsWith("--backend=")),
      () => { throw new Error("COURSE_COMMON_NOTE_BACKFILL_FAILED"); },
    ));
  } catch { failed = true; }
  finally { try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COURSE_COMMON_NOTE_BACKFILL_FAILED");
  return result;
}
