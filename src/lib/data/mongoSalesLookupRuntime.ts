import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import type { SalesRevenueSource } from "./salesRevenueSyncRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true; salesRevenueSource: SalesRevenueSource };
type Repositories = Readonly<Pick<DataRepositories, "operations" | "salesRevenueSource" | "requestActivity">>;
export const MONGO_SALES_LOOKUP_RUNTIME_MODELS = [...new Set([...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];

export async function openMongoSalesLookupRuntime(options: Options) {
  try {
    new MongoOperationStore(options, MONGO_SALES_LOOKUP_RUNTIME_MODELS);
    const [operations, requestActivity] = await Promise.all([
      MongoOperationRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const salesRevenueSource: SalesRevenueSource = Object.freeze({
      isConfigured: () => options.salesRevenueSource.isConfigured(),
      readSalesRecords: () => options.salesRevenueSource.readSalesRecords()
    });
    const repositories: Repositories = Object.freeze({ operations, salesRevenueSource, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_SALES_LOOKUP_RUNTIME_FAILED"); }
}

export async function prepareMongoSalesLookupRuntime(options: Options & { processSequenceHighWater: number }) {
  try {
    new MongoOperationStore(options, MONGO_SALES_LOOKUP_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoSalesLookupRuntime(options);
  } catch { throw new Error("MONGO_SALES_LOOKUP_RUNTIME_FAILED"); }
}
