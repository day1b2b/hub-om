import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { requireMongoShadowComposition } from "./mongoShadowComposition";
import { openMongoCompanyBusinessInfoRuntime } from "./mongoCompanyBusinessInfoRuntime";
import { runCompanyBusinessInfoUpdatedAtBackfillCommand, type CompanyBusinessInfoUpdatedAtBackfillSummary } from "./companyBusinessInfoUpdatedAtBackfillCommand";

type Environment = Record<string, string | undefined>;

export async function runCompanyBusinessInfoUpdatedAtBackfillCli(
  args: string[], env: Environment, loadDefaultEnvironment: () => void,
): Promise<CompanyBusinessInfoUpdatedAtBackfillSummary> {
  const backendArgs = args.filter(value => value.startsWith("--backend="));
  if (backendArgs.length === 0) return runCompanyBusinessInfoUpdatedAtBackfillCommand(args, loadDefaultEnvironment);
  if (backendArgs.length !== 1 || backendArgs[0] !== "--backend=mongodb-shadow") throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_FAILED");

  const { databaseName, namespace } = requireMongoShadowComposition(env);
  const client = new MongoClient(configuredMongoUri(env), mongoConnectionOptions());
  let result: CompanyBusinessInfoUpdatedAtBackfillSummary | undefined;
  let failed = false;
  try {
    await client.connect();
    const runtime = await openMongoCompanyBusinessInfoRuntime({ client, databaseName, namespace, allowShadowWrites: true });
    result = await runtime.run(() => runCompanyBusinessInfoUpdatedAtBackfillCommand(
      args.filter(value => !value.startsWith("--backend=")),
      () => { throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_FAILED"); },
    ));
  } catch { failed = true; }
  finally { try { await client.close(); } catch { failed = true; } }
  if (failed || !result) throw new Error("COMPANY_BUSINESS_INFO_UPDATED_AT_BACKFILL_FAILED");
  return result;
}
