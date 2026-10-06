import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import type { SalesRevenueCourse, SalesRevenueSyncLogInput, SalesRevenueSyncRepository, SalesRevenueUpdate } from "./salesRevenueSyncRepository";
import { operationAuditRow } from "./mongoOperationAudit";
import { numericMoney } from "./mongoNumericMoney";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const SALES_REVENUE_MODELS = ["Company", "Course", "SalesRevenueSyncLog", "ActivityChange"] as const;
export type MongoSalesRevenueOptions = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoSalesRevenueSyncStore(options: MongoSalesRevenueOptions): Promise<void> {
  try { await prepareMongoReadStore(options, SALES_REVENUE_MODELS); }
  catch { throw new MongoOperationError("SALES_REVENUE_PREPARE_FAILED"); }
}

export class MongoSalesRevenueSyncRepository implements SalesRevenueSyncRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoSalesRevenueOptions): Promise<MongoSalesRevenueSyncRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, SALES_REVENUE_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoSalesRevenueSyncRepository(store);
    } catch { throw new MongoOperationError("SALES_REVENUE_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + 120_000;
    const check = () => assertMongo(performance.now() < deadline, "SALES_REVENUE_TIMEOUT");
    const session = this.store.client.startSession();
    try {
      assertPrivacyConfiguration();
      // Keep original errors inside the driver retry loop, including commit uncertainty.
      return await session.withTransaction(async () => { check(); const value = await work(session, check); check(); return value; }, {
        readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary",
        timeoutMS: Math.max(1, Math.ceil(deadline - performance.now()))
      });
    } catch { throw new MongoOperationError("SALES_REVENUE_TRANSACTION_FAILED"); }
    finally { await session.endSession(); }
  }
  async listCourses(): Promise<SalesRevenueCourse[]> {
    return this.transaction(async (session, check) => {
      const courses = await this.store.scan("Course", { courseId: { $ne: "" } }, session);
      const companyIds = [...new Set(courses.map(row => row.companyId as string))];
      const companies = companyIds.length ? await this.store.scan("Company", { _id: { $in: companyIds } }, session) : [];
      check();
      const byId = new Map(companies.map(row => [row.id, row]));
      return courses.map(row => {
        const company = byId.get(row.companyId);
        assertMongo(company, "SALES_REVENUE_COMPANY_MISSING");
        return { id: row.id as string, courseId: row.courseId as string, name: row.name as string,
          revenue: row.revenue, company: { name: company.name as string } };
      });
    });
  }
  async applyUpdates(updates: readonly SalesRevenueUpdate[]): Promise<void> {
    await this.transaction(async (session, check) => {
      // Decisions and duplicate order belong to the initial workflow snapshot.
      // Retry only re-reads persisted rows for a narrow patch and truthful audit.
      for (const update of updates) {
        check();
        const before = await this.store.one("Course", { _id: update.id }, session);
        assertMongo(before, "SALES_REVENUE_COURSE_MISSING");
        const revenue = Number.isFinite(update.revenue) ? numericMoney(update.revenue) : null;
        const after = completeMongoRow("Course", { ...before, revenue, revenueRaw: String(update.revenue), updatedAt: new Date() });
        const encoded = encodeMongoRuntimeDocument("Course", after);
        const written = await this.store.collection("Course").updateOne({ _id: update.id }, {
          $set: { revenue: encoded.revenue, revenueRaw: encoded.revenueRaw, updatedAt: encoded.updatedAt }
        }, { session });
        assertMongo(written.matchedCount === 1, "SALES_REVENUE_COURSE_MISSING");
        const audit = operationAuditRow("Course", before, after);
        if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
        check();
      }
    });
  }
  async recordLog(input: SalesRevenueSyncLogInput): Promise<void> {
    try {
      const row = completeMongoRow("SalesRevenueSyncLog", { ...input, id: randomUUID(), startedAt: new Date() });
      await this.store.collection("SalesRevenueSyncLog").insertOne(encodeMongoRuntimeDocument("SalesRevenueSyncLog", row), { writeConcern: { w: "majority", j: true } });
    } catch { throw new MongoOperationError("SALES_REVENUE_LOG_FAILED"); }
  }
}
