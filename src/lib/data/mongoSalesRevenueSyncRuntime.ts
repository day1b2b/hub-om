import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoSalesRevenueSyncRepository, prepareMongoSalesRevenueSyncStore, SALES_REVENUE_MODELS } from "./mongoSalesRevenueSyncRepository";
import type { SalesRevenueNotifier, SalesRevenueSource } from "./salesRevenueSyncRepository";

type ScopeKey = "salesRevenueSync" | "salesRevenueSource" | "salesRevenueNotifier" | "requestActivity";
type Options = MongoOperationOptions & {
  allowShadowWrites: true;
  salesRevenueSource: SalesRevenueSource;
  salesRevenueNotifier: SalesRevenueNotifier;
};
export type MongoSalesRevenueSyncRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS = [...new Set([
  ...SALES_REVENUE_MODELS, ...REQUEST_AUDIT_MODELS
])] as readonly string[];

export interface MongoSalesRevenueSyncRuntime {
  readonly repositories: MongoSalesRevenueSyncRepositories;
  run<T>(work: () => T): T;
}

/** Explicit setup only. Existing or partial namespaces are never repaired. */
export async function prepareMongoSalesRevenueSyncRuntime(options: Options): Promise<MongoSalesRevenueSyncRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoSalesRevenueSyncStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoSalesRevenueSyncRuntime(options);
  } catch { throw new Error("MONGO_SALES_REVENUE_SYNC_RUNTIME_FAILED"); }
}

/** The scheduled sales sync uses one locked namespace and explicit source/notifier ports. */
export async function openMongoSalesRevenueSyncRuntime(options: Options): Promise<MongoSalesRevenueSyncRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_SALES_REVENUE_SYNC_RUNTIME_MODELS);
    const [salesRevenueSync, requestActivity] = await Promise.all([
      MongoSalesRevenueSyncRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const salesRevenueSource: SalesRevenueSource = Object.freeze({
      isConfigured: () => options.salesRevenueSource.isConfigured(),
      readSalesRecords: () => options.salesRevenueSource.readSalesRecords()
    });
    const salesRevenueNotifier: SalesRevenueNotifier = Object.freeze({
      notifyFailure: (text: string) => options.salesRevenueNotifier.notifyFailure(text)
    });
    const repositories: MongoSalesRevenueSyncRepositories = Object.freeze({
      salesRevenueSync, salesRevenueSource, salesRevenueNotifier, requestActivity
    });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_SALES_REVENUE_SYNC_RUNTIME_FAILED"); }
}
