import type { SalesRecord, SourceReadResult } from "../sourceReads/sourceReadTypes";

export interface SalesRevenueCourse {
  id: string;
  courseId: string;
  name: string;
  revenue: unknown;
  company: { name: string } | null;
}
export interface SalesRevenueUpdate { id: string; revenue: number }
export interface SalesRevenueSyncLogInput {
  status: string; applied: boolean; readCount: number; matched: number;
  filled: number; changed: number; unchanged: number; updatedRows: number;
  unmatched: number; ambiguous: number; triggeredBy: string;
  detail: { unmatchedCourseIds: string[]; multiCourseIds: string[]; multiDealCourseIds: string[];
    excludedCourseIds: string[]; dedupedCourseIds: string[]; issues: string[] };
}
export interface SalesRevenueSyncRepository {
  listCourses(): Promise<SalesRevenueCourse[]>;
  applyUpdates(updates: readonly SalesRevenueUpdate[]): Promise<void>;
  recordLog(input: SalesRevenueSyncLogInput): Promise<void>;
}
export interface SalesRevenueSource {
  isConfigured(): boolean;
  readSalesRecords(): Promise<SourceReadResult<SalesRecord>>;
}
export interface SalesRevenueNotifier { notifyFailure(text: string): Promise<void> }
