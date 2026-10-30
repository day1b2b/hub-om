import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition } from "./mongoShadowComposition";
import { openMongoOperationWriteRuntime } from "./mongoOperationWriteRuntime";
import { runResultReportStatusPromotionCommand, type ResultReportStatusPromotionCommandSummary } from "./resultReportStatusPromotionCommand";

type Environment = Record<string, string | undefined>;

export async function runResultReportStatusPromotionCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
): Promise<ResultReportStatusPromotionCommandSummary> {
  const backendArgs = args.filter(value => value.startsWith("--backend="));
  if (backendArgs.length === 0) return runResultReportStatusPromotionCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("RESULT_REPORT_STATUS_PROMOTION_FAILED");

  const { databaseName, namespace } = requireMongoShadowComposition(env);
  const client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
  let result: ResultReportStatusPromotionCommandSummary | undefined;
  let failed = false;
  try {
    await client.connect();
    const runtime = await openMongoOperationWriteRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    result = await runtime.run(() => runResultReportStatusPromotionCommand(
      args.filter(value => !value.startsWith("--backend=")),
      () => { throw new Error("RESULT_REPORT_STATUS_PROMOTION_FAILED"); },
    ));
  } catch { failed = true; }
  finally { try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("RESULT_REPORT_STATUS_PROMOTION_FAILED");
  return result;
}
