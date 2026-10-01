import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { hasSalesmapConfig, SalesmapSourceReader } from "../sourceReads/salesmapSourceReader";
import { openMongoSalesLookupRuntime } from "./mongoSalesLookupRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
import type { SalesRevenueSource } from "./salesRevenueSyncRepository";

interface Client { connect(): Promise<unknown>; close(): Promise<void> }
interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface SalesLookupCompositionDependencies {
  createClient(environment: MongoCompositionEnvironment): Client;
  source: SalesRevenueSource;
  openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; salesRevenueSource: SalesRevenueSource }): Promise<Runtime>;
}
const defaults: SalesLookupCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  source: Object.freeze({ isConfigured: hasSalesmapConfig, readSalesRecords: () => new SalesmapSourceReader().readSalesRecords() }),
  openRuntime: input => openMongoSalesLookupRuntime({ ...input, client: input.client as MongoClient })
};

export async function runSalesLookupRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: SalesLookupCompositionDependencies = defaults): Promise<T> {
  const backend = environment.SALES_LOOKUP_BACKEND?.trim() || "postgres";
  if (backend === "postgres") return work();
  if (backend !== "mongodb-shadow") throw new Error("SALES_LOOKUP_COMPOSITION_FAILED");
  let client: Client | undefined;
  try {
    const { databaseName, namespace } = requireMongoShadowComposition(environment);
    client = dependencies.createClient(environment);
    await client.connect();
    const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, salesRevenueSource: dependencies.source });
    return await runtime.run(work);
  } catch { throw new Error("SALES_LOOKUP_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
