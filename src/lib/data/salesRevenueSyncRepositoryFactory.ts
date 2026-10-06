import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { PrismaSalesRevenueSyncRepository } from "./prismaSalesRevenueSyncRepository";
import type { SalesRevenueNotifier, SalesRevenueSource, SalesRevenueSyncRepository } from "./salesRevenueSyncRepository";
import { hasSalesmapConfig, SalesmapSourceReader } from "../sourceReads/salesmapSourceReader";

export function getSalesRevenueSyncRepository(): SalesRevenueSyncRepository {
  return getDataRepositoryOverride("salesRevenueSync") ?? new PrismaSalesRevenueSyncRepository();
}
export function getSalesRevenueSource(): SalesRevenueSource {
  return getDataRepositoryOverride("salesRevenueSource") ?? {
    isConfigured: hasSalesmapConfig,
    readSalesRecords: () => new SalesmapSourceReader().readSalesRecords()
  };
}
export function getSalesRevenueNotifier(): SalesRevenueNotifier {
  return getDataRepositoryOverride("salesRevenueNotifier") ?? {
    async notifyFailure(text) { await (await import("./salesRevenueNotifier")).notifySalesSyncFailure(text); }
  };
}
