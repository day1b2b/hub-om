import { MongoClient } from "mongodb";
import { configuredMongoUri, mongoConnectionOptions } from "../mongodb/connection";
import { hasSalesmapConfig, SalesmapSourceReader } from "../sourceReads/salesmapSourceReader";
import { openMongoSalesRevenueSyncRuntime } from "./mongoSalesRevenueSyncRuntime";
import { requireMongoShadowComposition, type MongoCompositionEnvironment } from "./mongoShadowComposition";
import type { SalesRevenueNotifier, SalesRevenueSource } from "./salesRevenueSyncRepository";
interface Client { connect(): Promise<unknown>; close(): Promise<void> } interface Runtime { run<T>(work: () => Promise<T>): Promise<T> }
export interface SalesSyncCompositionDependencies { createClient(environment: MongoCompositionEnvironment): Client; source: SalesRevenueSource; notifier: SalesRevenueNotifier; openRuntime(input: { client: Client; databaseName: string; namespace: string; allowShadowWrites: true; salesRevenueSource: SalesRevenueSource; salesRevenueNotifier: SalesRevenueNotifier }): Promise<Runtime> }
const defaults: SalesSyncCompositionDependencies = {
  createClient: environment => new MongoClient(configuredMongoUri(environment), mongoConnectionOptions()),
  source: Object.freeze({ isConfigured: hasSalesmapConfig, readSalesRecords: () => new SalesmapSourceReader().readSalesRecords() }),
  notifier: Object.freeze({ async notifyFailure(text: string) { await (await import("./salesRevenueNotifier")).notifySalesSyncFailure(text); } }),
  openRuntime: input => openMongoSalesRevenueSyncRuntime({ ...input, client: input.client as MongoClient })
};
export async function runSalesSyncRequest<T>(work: () => Promise<T>, environment: MongoCompositionEnvironment = process.env, dependencies: SalesSyncCompositionDependencies = defaults): Promise<T> {
  const backend = environment.SALES_SYNC_BACKEND?.trim() || "postgres"; if (backend === "postgres") return work(); if (backend !== "mongodb-shadow") throw new Error("SALES_SYNC_COMPOSITION_FAILED"); let client: Client | undefined;
  try { const { databaseName, namespace } = requireMongoShadowComposition(environment); client = dependencies.createClient(environment); await client.connect(); const runtime = await dependencies.openRuntime({ client, databaseName, namespace, allowShadowWrites: true, salesRevenueSource: dependencies.source, salesRevenueNotifier: dependencies.notifier }); return await runtime.run(work); }
  catch { throw new Error("SALES_SYNC_COMPOSITION_FAILED"); }
  finally { if (client) try { await client.close(); } catch {} }
}
