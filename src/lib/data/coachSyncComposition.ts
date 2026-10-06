import { MongoClient } from "mongodb";
import { readContractSheetSource } from "../coaches/contractSheetSync";
import { readNotionCoachPages } from "../coaches/notionCoachSync";
import { readSamsungSheetSource } from "../coaches/samsungScheduleSync";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import type { CoachNotionSource } from "./coachNotionSyncRepository";
import type { CoachSheetSource } from "./coachSheetSyncRepository";
import { openMongoCoachSyncRuntime } from "./mongoCoachSyncRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface CoachSyncCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  notionSource: CoachNotionSource;
  sheetSource: CoachSheetSource;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; coachNotionSource: CoachNotionSource; coachSheetSource: CoachSheetSource }): Promise<Runtime>;
}
const defaults: CoachSyncCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  notionSource: Object.freeze({ readPages: readNotionCoachPages }),
  sheetSource: Object.freeze({ readContract: readContractSheetSource, readSamsung: readSamsungSheetSource }),
  openRuntime: input => openMongoCoachSyncRuntime({ ...input, client: input.client as MongoClient })
};

export async function runCoachSyncRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: CoachSyncCompositionDependencies = defaults): Promise<T> {
  const backend = environment.COACH_SYNC_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("COACH_SYNC_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, coachNotionSource: dependencies.notionSource, coachSheetSource: dependencies.sheetSource });
    return await runtime.run(work);
  } catch { throw new Error("COACH_SYNC_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch { /* Preserve an already audited response. */ } }
}
