import { BSON, MongoServerError, type ClientSession, type Document } from "mongodb";
import { AdminDatabaseCellError, type AdminDatabaseCellUpdate, type AdminDatabaseRepository } from "./adminDatabaseRepository";
import type { AdminDatabaseRows } from "./adminDatabaseRows";
import { getAdminEditableField } from "../admin/databaseEditConfig";
import { buildDatabaseDashboard, DATABASE_TABLE_SAMPLE_LIMIT } from "../admin/databaseDashboardPresenter";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MONGO_SCAN_BYTES, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull, mongoRuntimeContracts } from "./mongoRuntimeCodec";
import policies from "../privacy/fields.json" with { type: "json" };

export const ADMIN_DATABASE_MODELS = ["Company", "Course", "OperationSession", "Member", "DataImportRun", "OperationSourceRecord", "DriveImportRun", "DriveImportResult", "ActivityChange"] as const;
export type MongoAdminDatabaseOptions = MongoOperationOptions & { allowShadowWrites: true };
const TIMEOUT_MS = 30_000;
const privacy = policies as Record<string, { fields: Record<string, { index?: string; storage?: string }> }>;
const tableModel = { companies: "Company", courses: "Course", members: "Member", operation_sessions: "OperationSession" } as const;

export async function prepareMongoAdminDatabaseStore(options: MongoAdminDatabaseOptions): Promise<void> {
  try { await prepareMongoReadStore(options, ADMIN_DATABASE_MODELS); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("ADMIN_DATABASE_PREPARE_FAILED");
  }
}
function canonicalId(value: string): string {
  if (typeof value !== "string") throw new AdminDatabaseCellError("INVALID_UUID");
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text)) throw new AdminDatabaseCellError("INVALID_UUID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Round the Number's decimal wire representation to numeric(14,2), including
 * exponent notation and negative half ties. Never multiply a floating value by 100.
 */
function numericMoney(value: number): string {
  if (!Number.isFinite(value)) throw new AdminDatabaseCellError("INVALID_DECIMAL");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new AdminDatabaseCellError("INVALID_DECIMAL");
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2] + fraction);
  const shift = Number(match[4] ?? 0) - fraction.length + 2;
  let cents: bigint;
  if (shift >= 0) cents = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    cents = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
  }
  if (cents >= 100_000_000_000_000n) throw new AdminDatabaseCellError("DECIMAL_OVERFLOW");
  return `${match[1] && cents !== 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
function displayRow(row: MongoRow): MongoRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull || value === MongoJsonNull ? null : value]));
}

export class MongoAdminDatabaseRepository implements AdminDatabaseRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoAdminDatabaseOptions): Promise<MongoAdminDatabaseRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, ADMIN_DATABASE_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoAdminDatabaseRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("ADMIN_DATABASE_OPEN_FAILED");
    }
  }
  private async transaction<T>(work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    try {
      const deadline = performance.now() + TIMEOUT_MS;
      const check = () => assertMongo(performance.now() < deadline, "ADMIN_DATABASE_TIMEOUT");
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          check(); const result = await work(session, check); check(); return result;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: TIMEOUT_MS });
      } finally { await session.endSession(); }
    } catch (error) {
      // Labeled write conflicts reach the driver first; every retry re-reads the
      // current row. Unique violations retain the route's established 409 code.
      if (error instanceof AdminDatabaseCellError || error instanceof MongoOperationError) throw error;
      if (error instanceof MongoServerError && error.code === 11000) throw new AdminDatabaseCellError("P2002");
      throw new MongoOperationError("ADMIN_DATABASE_TRANSACTION_FAILED");
    }
  }

  private async sample(model: string, session: ClientSession, check: () => void): Promise<MongoRow[]> {
    const deadline = performance.now() + 15_000;
    const dateField = model === "DataImportRun" || model === "DriveImportRun" ? "startedAt"
      : model === "OperationSourceRecord" || model === "DriveImportResult" ? "createdAt" : "updatedAt";
    const order: Array<[string, 1 | -1]> = model === "Member"
      ? [["isActive", -1], ["__adminNullRank", 1], ["displayOrder", 1], ["updatedAt", -1], ["_id", 1]]
      : [[dateField, -1], ["_id", 1]];
    const rows: MongoRow[] = [];
    let last: Document | undefined, bytes = 0;
    while (rows.length < DATABASE_TABLE_SAMPLE_LIMIT) {
      check(); assertMongo(performance.now() < deadline, "ADMIN_DATABASE_SAMPLE_TIMEOUT");
      const after: Document[] = [];
      if (last) {
        const prefix: Document = {};
        for (const [key, direction] of order) {
          // displayOrder nulls have their own last group; skip a BSON null range
          // comparison and continue within that group's date/id ordering.
          if (last[key] !== null) after.push({ ...prefix, [key]: { [direction === 1 ? "$gt" : "$lt"]: last[key] } });
          prefix[key] = last[key];
        }
      }
      const remaining = DATABASE_TABLE_SAMPLE_LIMIT - rows.length;
      const cursor = this.store.collection(model).aggregate<Document>([
        ...(model === "Member" ? [{ $set: { __adminNullRank: { $cond: [{ $eq: ["$displayOrder", null] }, 1, 0] } } }] : []),
        ...(last ? [{ $match: { $or: after } }] : []),
        { $sort: Object.fromEntries(order) }, { $limit: remaining }
      ], { session, batchSize: remaining, allowDiskUse: false, collation: { locale: "simple" }, maxTimeMS: Math.max(1, Math.ceil(deadline - performance.now())) });
      let batch: Document[];
      // Read only firstBatch via public APIs, close, then keyset from the actual
      // last returned row. Never interpret a BSON-short batch as end-of-results.
      try {
        const first = await cursor.next();
        batch = first === null ? [] : [first, ...cursor.readBufferedDocuments()];
      } finally { await cursor.close(); }
      assertMongo(batch.length <= remaining, "ADMIN_DATABASE_SAMPLE_LIMIT");
      for (const document of batch) {
        bytes += BSON.calculateObjectSize(document);
        assertMongo(bytes <= MONGO_SCAN_BYTES, "ADMIN_DATABASE_SAMPLE_LIMIT");
        last = document;
        const raw = { ...document }; if (model === "Member") delete raw.__adminNullRank;
        rows.push(displayRow(decodeMongoRuntimeDocument(model, raw)));
      }
      assertMongo(performance.now() < deadline, "ADMIN_DATABASE_SAMPLE_TIMEOUT");
      if (!batch.length) break;
    }
    return rows;
  }

  async readDashboard() {
    return this.transaction(async (session, check) => {
      const models = ADMIN_DATABASE_MODELS.filter(model => model !== "ActivityChange");
      const counts = new Map<string, number>(), samples = new Map<string, MongoRow[]>();
      for (const model of models) {
        check(); counts.set(model, await this.store.collection(model).countDocuments({}, { session, maxTimeMS: 15_000 }));
        samples.set(model, await this.sample(model, session, check));
      }
      const required = new Map<string, MongoRow>();
      const relationDeadline = performance.now() + 15_000;
      let relationBytes = 0;
      const checkRelations = () => {
        check(); assertMongo(performance.now() < relationDeadline, "ADMIN_DATABASE_RELATION_TIMEOUT");
      };
      const related = async (model: string, id: unknown): Promise<MongoRow> => {
        checkRelations(); assertMongo(typeof id === "string", "ADMIN_DATABASE_MISSING_RELATION");
        const key = `${model}:${id}`;
        let row = required.get(key);
        if (!row) {
          const found = await this.store.collection(model).findOne({ _id: id }, { session, maxTimeMS: Math.max(1, Math.ceil(relationDeadline - performance.now())), collation: { locale: "simple" } });
          assertMongo(found, "ADMIN_DATABASE_MISSING_RELATION");
          relationBytes += BSON.calculateObjectSize(found);
          assertMongo(relationBytes <= MONGO_SCAN_BYTES, "ADMIN_DATABASE_RELATION_LIMIT");
          row = displayRow(decodeMongoRuntimeDocument(model, found)); required.set(key, row);
          checkRelations();
        }
        return row;
      };
      const exists = async (model: string, field: string, id: unknown) => {
        checkRelations();
        // Existence is across the whole collection, including rows outside the
        // dashboard sample and deleted sessions, exactly as the PG relation query.
        const row = await this.store.collection(model).findOne({ [field]: id }, { projection: { _id: 1 }, session, maxTimeMS: 15_000, collation: { locale: "simple" } });
        checkRelations();
        return row ? [{ id: row._id }] : [];
      };
      const companies = [];
      for (const row of samples.get("Company")!) companies.push({ ...row, courses: await exists("Course", "companyId", row.id) });
      const courses = [];
      for (const row of samples.get("Course")!) courses.push({ ...row, company: { name: (await related("Company", row.companyId)).name }, sessions: await exists("OperationSession", "courseRecordId", row.id) });
      const operationSessions = [];
      for (const row of samples.get("OperationSession")!) {
        const course = await related("Course", row.courseRecordId);
        operationSessions.push({ ...row, course: { name: course.name, company: { name: (await related("Company", course.companyId)).name } } });
      }
      const operationSourceRecords = [];
      for (const row of samples.get("OperationSourceRecord")!) {
        operationSourceRecords.push({ ...row, operationSession: row.operationSessionId === null ? null : { operationId: (await related("OperationSession", row.operationSessionId)).operationId } });
      }
      // The full codec validates storage types; relation projections above match
      // the type-only PG query contract. Decimal strings intentionally keep 0 truthy.
      const input = {
        companyCount: counts.get("Company")!, companies,
        courseCount: counts.get("Course")!, courses,
        operationSessionCount: counts.get("OperationSession")!, operationSessions,
        memberCount: counts.get("Member")!, members: samples.get("Member")!,
        dataImportRunCount: counts.get("DataImportRun")!, dataImportRuns: samples.get("DataImportRun")!,
        operationSourceRecordCount: counts.get("OperationSourceRecord")!, operationSourceRecords,
        driveImportRunCount: counts.get("DriveImportRun")!, driveImportRuns: samples.get("DriveImportRun")!,
        driveImportResultCount: counts.get("DriveImportResult")!, driveImportResults: samples.get("DriveImportResult")!
      } as unknown as AdminDatabaseRows;
      check(); return buildDatabaseDashboard(input);
    });
  }

  async updateCell(input: AdminDatabaseCellUpdate): Promise<void> {
    if (!getAdminEditableField(input.table, input.field)) throw new AdminDatabaseCellError("READ_ONLY_FIELD");
    const model = tableModel[input.table];
    if (!model) throw new AdminDatabaseCellError("READ_ONLY_FIELD");
    const id = canonicalId(input.rowId);
    await this.transaction(async (session, check) => {
      const previous = await this.store.one(model, { _id: id }, session);
      if (!previous) throw new AdminDatabaseCellError("P2025");
      const definition = mongoRuntimeContracts[model].fields[input.field];
      let value: unknown = input.value;
      if (input.field === "name" && (model === "Company" || model === "Member")) value = String(value);
      if (definition.type === "Decimal" && value !== null) {
        if (typeof value !== "number") throw new AdminDatabaseCellError("INVALID_DECIMAL");
        value = numericMoney(value);
      }
      if (definition.dateOnly && value instanceof Date && Number.isFinite(value.getTime())) {
        // The existing adapter-pg date wire format rejects year zero/BC dates.
        // Keep the same failure for route-accepted JS year 0000; do not invent
        // start/end ordering or calendar-rollover validation.
        if (value.getUTCFullYear() < 1) throw new AdminDatabaseCellError("INVALID_DATE");
        value = new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
      }
      const patch: MongoRow = { [input.field]: value, updatedAt: new Date() };
      if (input.field === "name" && (model === "Company" || model === "Member")) patch.normalizedName = String(value).trim().replace(/\s+/g, " ").toLowerCase();
      if (model === "OperationSession") patch.updatedBy = input.updatedBy;
      const next = completeMongoRow(model, { ...previous, ...patch });
      const encoded = encodeMongoRuntimeDocument(model, next);
      const persisted: Document = {};
      for (const field of Object.keys(patch)) {
        persisted[field] = encoded[field];
        const policy = privacy[model]?.fields[field];
        if (policy?.index) persisted[policy.index] = encoded[policy.index];
        if (policy?.storage) persisted[policy.storage] = encoded[policy.storage];
      }
      check();
      const changed = await this.store.collection(model).updateOne({ _id: id }, { $set: persisted }, { session });
      if (changed.matchedCount !== 1) throw new AdminDatabaseCellError("P2025");
      check();
      const audit = operationAuditRow(model, previous, next);
      if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    });
  }
}
