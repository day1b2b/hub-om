import { randomUUID } from "node:crypto";
import type { SourceTeam } from "@prisma/client";
import { MongoServerError, type ClientSession } from "mongodb";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { NOTION_PROMOTION_ERROR, type ImportPromotionRepository, type ImportPromotionResult, type ImportPromotionTransaction, type SourceOnlyPromotionRepository, type SourceOnlyPromotionResult } from "./importPromotionContract";
import { promoteImportRows, promoteSourceOnlyRows } from "./importPromotionCore";
import { numericMoney } from "./mongoNumericMoney";
import { operationAuditRow } from "./mongoOperationAudit";
import { applyMongoValidator, assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, operationMongoValidator, stableMongoValue, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongoCourseNameRestoreGuardReady, lockMongoCourseNameRestore, prepareMongoCourseNameRestoreGuard } from "./mongoCourseNameRestoreGuard";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";

export const IMPORT_PROMOTION_MODELS = ["DataImportRun", "OperationSourceRecord", "Company", "Course", "OperationSession", "ActivityChange"] as const;
export type MongoImportPromotionOptions = MongoOperationOptions & { allowShadowWrites: true };
const MAX_SEQUENCE = 2_147_483_647;
const TIMEOUT_MS = 60_000;
class FirstGuardRace extends Error {}
class NaturalKeyRace extends Error {}

/** Only a competing insert of this exact upsert key may restart the snapshot.
 * ID/fingerprint/sequence/audit/commit errors are never classified as upsert races.
 */
function isNaturalKeyRace(error: unknown, model: string, document: MongoRow): boolean {
  if (!(error instanceof MongoServerError) || error.code !== 11000) return false;
  const fields = model === "Company" ? ["normalizedName"] : model === "Course" ? ["companyId", "courseId", "name"] : [];
  if (!fields.length || !error.keyPattern || !error.keyValue) return false;
  return Object.keys(error.keyPattern).length === fields.length && Object.keys(error.keyValue).length === fields.length
    && fields.every(field => Object.hasOwn(error.keyPattern, field) && error.keyPattern[field] === 1
      && Object.hasOwn(error.keyValue, field) && error.keyValue[field] === document[field]);
}

async function highestSequence(store: MongoOperationStore): Promise<number> {
  const row = await store.collection("Course").find({}, { projection: { processSeq: 1 }, maxTimeMS: 15_000 }).sort({ processSeq: -1 }).limit(1).next();
  const value = row?.processSeq ?? 0;
  assertMongo(Number.isInteger(value) && value >= 0 && value <= MAX_SEQUENCE, "IMPORT_PROMOTION_INVALID_SEQUENCE");
  return value;
}
async function assertCounterReady(store: MongoOperationStore): Promise<void> {
  const collection = store.collection("__counter");
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && info.options?.validationLevel === "strict" && info.options?.validationAction === "error"
    && stableMongoValue(info.options.validator) === stableMongoValue(operationMongoValidator("__counter"))
    && (!info.options.collation || info.options.collation.locale === "simple") && !info.options.capped, "IMPORT_PROMOTION_COUNTER_NOT_READY");
  const indexes = await collection.listIndexes().toArray();
  assertMongo(indexes.some(index => index.name === "_id_" && JSON.stringify(index.key) === JSON.stringify({ _id: 1 }))
    && indexes.every(index => index.expireAfterSeconds === undefined), "IMPORT_PROMOTION_COUNTER_NOT_READY");
  const counter = await collection.findOne({ _id: "Course.processSeq" }, { maxTimeMS: 15_000 });
  assertMongo(counter && Number.isInteger(counter.value) && counter.value >= await highestSequence(store) && counter.value <= MAX_SEQUENCE,
    "IMPORT_PROMOTION_COUNTER_NOT_READY");
}

/** Explicit preparation of an owned shadow only. Runtime open never repairs it. */
export async function prepareMongoImportPromotionStore(options: MongoImportPromotionOptions & { processSequenceHighWater: number }): Promise<void> {
  try {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    assertMongo(Number.isInteger(options.processSequenceHighWater) && options.processSequenceHighWater >= 0 && options.processSequenceHighWater <= MAX_SEQUENCE,
      "IMPORT_PROMOTION_INVALID_SEQUENCE_HIGH_WATER");
    await prepareMongoReadStore(options, IMPORT_PROMOTION_MODELS);
    const store = new MongoOperationStore(options, IMPORT_PROMOTION_MODELS);
    await applyMongoValidator(store, "__counter", operationMongoValidator("__counter"));
    await store.collection("__counter").updateOne({ _id: "Course.processSeq" }, {
      $max: { value: Math.max(options.processSequenceHighWater, await highestSequence(store)) }
    }, { upsert: true });
    await prepareMongoCourseNameRestoreGuard(store, options.allowShadowWrites);
    await assertCounterReady(store);
  } catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("IMPORT_PROMOTION_PREPARE_FAILED");
  }
}

function canonicalUuid(value: string): string {
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  assertMongo(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text), "IMPORT_PROMOTION_INVALID_UUID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function presentationJson(value: unknown): unknown { return value === MongoDbNull || value === MongoJsonNull ? null : value; }
function normalizedCompany(value: string): string {
  return value.split("\n").map(line => line.trim().replace(/[^\S\n]+/g, " ")).join("\n").trim().toLowerCase();
}

/** No production selection and no external effects inside transaction retries. */
export class MongoImportPromotionRepository implements ImportPromotionRepository, SourceOnlyPromotionRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoImportPromotionOptions): Promise<MongoImportPromotionRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      assertPrivacyConfiguration();
      const store = new MongoOperationStore(options, IMPORT_PROMOTION_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertCounterReady(store);
      await assertMongoCourseNameRestoreGuardReady(store);
      return new MongoImportPromotionRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("IMPORT_PROMOTION_OPEN_FAILED");
    }
  }

  async promoteReadyImportRows(importRunId: string): Promise<ImportPromotionResult> {
    const deadline = performance.now() + TIMEOUT_MS;
    const check = () => assertMongo(performance.now() < deadline, "IMPORT_PROMOTION_TIMEOUT");
    try {
      assertPrivacyConfiguration();
      const teamMembers = getDataRepositoryOverride("teamMembers");
      assertMongo(teamMembers, "IMPORT_PROMOTION_ROSTER_SCOPE_REQUIRED");
      const roster = await teamMembers.listRoleRosters();
      check();
      const runId = canonicalUuid(importRunId);
      for (let attempt = 0; attempt < 5; attempt++) {
        check();
        const session = this.store.client.startSession();
        try {
          return await session.withTransaction(async () => {
            check();
            try { await lockMongoCourseNameRestore(this.store, session); }
            catch (error) {
              // Do not turn an arbitrary business duplicate or uncertain commit
              // into a new promotion attempt. This catch covers only the guard.
              if (error instanceof MongoServerError && error.code === 11000) throw new FirstGuardRace();
              throw error;
            }
            check();
            const result = await promoteImportRows(this.port(session, check), runId, roster);
            check();
            return result;
          }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary",
            timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
        } catch (error) {
          if ((error instanceof FirstGuardRace || error instanceof NaturalKeyRace) && attempt < 4) continue;
          throw error;
        } finally { await session.endSession(); }
      }
      throw new MongoOperationError("IMPORT_PROMOTION_RETRY_LIMIT");
    } catch (error) {
      if (error instanceof Error && error.message === NOTION_PROMOTION_ERROR) throw new Error(NOTION_PROMOTION_ERROR);
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("IMPORT_PROMOTION_FAILED");
    }
  }

  async promoteSourceOnlyRows(sourceTeam: SourceTeam, apply: boolean): Promise<SourceOnlyPromotionResult> {
    const deadline = performance.now() + TIMEOUT_MS;
    const check = () => assertMongo(performance.now() < deadline, "SOURCE_ONLY_PROMOTION_TIMEOUT");
    try {
      assertPrivacyConfiguration();
      const memberStore = new MongoOperationStore({ client: this.store.client, databaseName: this.store.db.databaseName, namespace: this.store.namespace }, ["Member"]);
      await assertMongoReadStoreReady(memberStore);
      for (let attempt = 0; attempt < 5; attempt++) {
        const session = this.store.client.startSession();
        try {
          return await session.withTransaction(async () => {
            check();
            if (apply) {
              try { await lockMongoCourseNameRestore(this.store, session); }
              catch (error) {
                if (error instanceof MongoServerError && error.code === 11000) throw new FirstGuardRace();
                throw error;
              }
            }
            const sources = await this.store.scan("OperationSourceRecord", { sourceTeam, operationSessionId: null }, session);
            sources.sort((a, b) => String(a.sourceSheet).localeCompare(String(b.sourceSheet), "ko") || Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
            const members = await memberStore.scan("Member", { isActive: true, role: { $in: ["OM", "LD"] } }, session);
            members.sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.sourceTeam).localeCompare(String(b.sourceTeam))
              || Number(a.displayOrder) - Number(b.displayOrder) || String(a.name).localeCompare(String(b.name), "ko"));
            const roster = { om: {} as Record<string, string[]>, ld: {} as Record<string, string[]> };
            for (const member of members) {
              const role = member.role === "OM" ? "om" : "ld";
              const team = member.sourceTeam === "TEAM_1" ? "1팀" : member.sourceTeam === "TEAM_2" ? "2팀" : "미분류";
              roster[role][team] = [...(roster[role][team] ?? []), String(member.name)];
            }
            check();
            return promoteSourceOnlyRows(this.port(session, check), sources.map(row => ({
              id: String(row.id),
              mappedFields: presentationJson(row.mappedFields) as Parameters<typeof promoteSourceOnlyRows>[1][number]["mappedFields"],
              validationErrors: presentationJson(row.validationErrors) as Parameters<typeof promoteSourceOnlyRows>[1][number]["validationErrors"],
              sourceFingerprint: typeof row.sourceFingerprint === "string" ? row.sourceFingerprint : null,
              sourceTeam: row.sourceTeam as SourceTeam
            })), roster, apply);
          }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary",
            timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
        } catch (error) {
          if (apply && (error instanceof FirstGuardRace || error instanceof NaturalKeyRace) && attempt < 4) continue;
          throw error;
        } finally { await session.endSession(); }
      }
      throw new MongoOperationError("SOURCE_ONLY_PROMOTION_RETRY_LIMIT");
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("SOURCE_ONLY_PROMOTION_FAILED");
    }
  }

  private port(session: ClientSession, check: () => void): ImportPromotionTransaction {
    const store = this.store;
    const one = async (model: string, id: string) => { check(); const row = await store.one(model, { _id: id }, session); check(); return row; };
    const assertOperationLinks = async (row: MongoRow) => {
      const course = await one("Course", String(row.courseRecordId));
      assertMongo(course, "IMPORT_PROMOTION_MISSING_COURSE");
      assertMongo(await one("Company", String(course.companyId)), "IMPORT_PROMOTION_MISSING_COMPANY");
    };
    const write = async (model: string, previous: MongoRow | null, fields: MongoRow): Promise<MongoRow> => {
      check();
      const row = completeMongoRow(model, fields);
      const document = encodeMongoRuntimeDocument(model, row);
      check();
      if (previous) {
        const result = await store.collection(model).replaceOne({ _id: String(previous.id) }, document, { session });
        assertMongo(result.matchedCount === 1, "IMPORT_PROMOTION_ROW_DISAPPEARED");
      } else {
        try { await store.collection(model).insertOne(document, { session }); }
        catch (error) {
          if (isNaturalKeyRace(error, model, document)) throw new NaturalKeyRace();
          throw error;
        }
      }
      // On PG INSERT, absent and present JSON null differ. Force only this
      // promotion's creation fields; ordinary updates retain logical/HMAC no-ops.
      const audit = operationAuditRow(model, previous, row, previous ? [] : Object.keys(row));
      if (audit) await store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
      check();
      return row;
    };
    const values = (input: MongoRow): MongoRow => {
      const result = { ...input };
      for (const field of ["revenue", "totalCost", "instructorCost", "operationCost"]) {
        if (typeof result[field] === "number") result[field] = numericMoney(result[field], code => new MongoOperationError(`IMPORT_PROMOTION_${code}`));
      }
      return result;
    };
    return {
      async getRun(id) {
        const row = await one("DataImportRun", id);
        return row ? { sourceType: row.sourceType as string } : null;
      },
      async listUnlinkedSources(id) {
        check();
        const rows = await store.scan("OperationSourceRecord", { importRunId: id, operationSessionId: null }, session);
        // PG's required FK makes an orphan source impossible. A missing run
        // with no source still returns the original empty summary, but an
        // orphan must not bypass source-type checks or create operations.
        if (rows.length) assertMongo(await one("DataImportRun", id), "IMPORT_PROMOTION_MISSING_RUN");
        rows.sort((a, b) => String(a.sourceSheet).localeCompare(String(b.sourceSheet), "ko") || Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
        check();
        return rows.map(row => ({ ...row, mappedFields: presentationJson(row.mappedFields), validationErrors: presentationJson(row.validationErrors) })) as Awaited<ReturnType<ImportPromotionTransaction["listUnlinkedSources"]>>;
      },
      async findByFingerprint(fingerprint) {
        if (!fingerprint) return null;
        check();
        const row = await store.one("OperationSession", { sourceFingerprint: fingerprint }, session);
        check();
        if (!row) return null;
        await assertOperationLinks(row);
        return { id: String(row.id), deletedAt: row.deletedAt as Date | null };
      },
      async findByBusinessKey(input) {
        check();
        const company = await store.one("Company", { normalizedName: normalizedCompany(input.companyName) }, session);
        if (!company) { check(); return null; }
        const courses = await store.scan("Course", { companyId: company.id, name: input.courseName }, session);
        if (!courses.length) { check(); return null; }
        const rows = await store.scan("OperationSession", { deletedAt: null, startDate: input.startDate, endDate: input.endDate,
          courseRecordId: { $in: courses.map(course => course.id as string) } }, session);
        check();
        // The original findFirst has no orderBy and excludes no extra team,
        // courseId or round. Any one qualified candidate is a valid match.
        return rows[0] ? { id: String(rows[0].id) } : null;
      },
      async upsertCompany(input) {
        check();
        const previous = await store.one("Company", { normalizedName: input.normalizedName }, session);
        const now = new Date();
        const row = await write("Company", previous, previous ? { ...previous, name: input.name, updatedAt: now }
          : { ...input, id: randomUUID(), createdAt: now, updatedAt: now });
        return { id: String(row.id) };
      },
      async upsertCourse(input) {
        assertMongo(await one("Company", input.companyId), "IMPORT_PROMOTION_MISSING_COMPANY");
        check();
        const previous = await store.one("Course", { companyId: input.companyId, courseId: input.courseId, name: input.name }, session);
        const now = new Date();
        const patch = values({ operationType: input.operationType, revenue: input.revenue, revenueRaw: input.revenueRaw });
        if (previous) return { id: String((await write("Course", previous, { ...previous, ...patch, updatedAt: now })).id) };
        const counter = await store.collection("__counter").findOneAndUpdate({ _id: "Course.processSeq", value: { $lt: MAX_SEQUENCE } },
          { $inc: { value: 1 } }, { session, returnDocument: "after" });
        assertMongo(counter && Number.isInteger(counter.value) && counter.value > 0, "IMPORT_PROMOTION_SEQUENCE_EXHAUSTED_OR_MISSING");
        const row = await write("Course", null, { ...input, ...patch, id: randomUUID(), processSeq: counter.value, createdAt: now, updatedAt: now });
        return { id: String(row.id) };
      },
      async createOperation(input) {
        await assertOperationLinks(input);
        const now = new Date();
        const row = await write("OperationSession", null, { hasSatisfactionSurvey: "NEEDS_REVIEW", ...values(input),
          id: randomUUID(), createdAt: now, updatedAt: now });
        return { id: String(row.id) };
      },
      async restoreOperation(id, input) {
        const previous = await one("OperationSession", id);
        assertMongo(previous, "IMPORT_PROMOTION_MISSING_OPERATION");
        await assertOperationLinks(previous);
        await write("OperationSession", previous, { ...previous, ...values(input), updatedAt: new Date() });
      },
      async linkSource(id, operationSessionId) {
        const operation = await one("OperationSession", operationSessionId);
        assertMongo(operation, "IMPORT_PROMOTION_MISSING_OPERATION");
        await assertOperationLinks(operation);
        const source = await one("OperationSourceRecord", id);
        assertMongo(source, "IMPORT_PROMOTION_MISSING_SOURCE");
        check();
        const result = await store.collection("OperationSourceRecord").updateOne({ _id: id }, { $set: { operationSessionId } }, { session });
        assertMongo(result.matchedCount === 1, "IMPORT_PROMOTION_ROW_DISAPPEARED");
        check();
      }
    };
  }
}
