import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { ImportRepository } from "./importRepository";
import type { ImportRunDetail, ImportRunSummary } from "./importTypes";
import type { ImportStagingRepository, StoreImportInput, StoreImportResult } from "./importStagingWriter";
import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { presentImportRun, toSourceRecordPreview, type ImportRunPresentationRow, type SourceRecordPresentationRow } from "./importReviewPresenter";
import { planImportRows, validateImportRows } from "./importStagingValidation";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";

export const IMPORT_MODELS = ["DataImportRun", "OperationSourceRecord", "OperationSession", "Course", "Company"] as const;
export interface MongoImportOptions extends MongoOperationOptions { allowShadowWrites: true }

export function prepareMongoImportStore(options: MongoImportOptions): Promise<void> {
  return prepareMongoReadStore(options, IMPORT_MODELS);
}

function uuid(value: string): string {
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  assertMongo(/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text), "IMPORT_INVALID_UUID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Prisma presents both SQL NULL and JSON null as null; the runtime codec keeps
// their storage distinction. Only normalize the top-level presentation values.
function presentation(row: MongoRow): MongoRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "symbol" ? null : value]));
}

/** Explicit shadow adapter. Production selection, parsing and authorization stay
 * with the existing boundaries. No run-wide deduplication lock is introduced:
 * like PG, two uploads whose duplicate reads precede both commits may both store.
 */
export class MongoImportRepository implements ImportRepository, ImportStagingRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoImportOptions): Promise<MongoImportRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, IMPORT_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoImportRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("IMPORT_OPEN_FAILED");
    }
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("IMPORT_FAILED");
    }
  }

  private async transaction<T>(deadline: number, work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    const check = () => assertMongo(performance.now() < deadline, "IMPORT_TIMEOUT");
    check();
    const session = this.store.client.startSession();
    try {
      return await session.withTransaction(async () => {
        check();
        const result = await work(session, check);
        check();
        return result;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: Math.max(1, Math.ceil(deadline - performance.now())) });
    } finally { await session.endSession(); }
  }

  async listImportRuns(): Promise<ImportRunSummary[]> {
    return this.safe(() => this.transaction(performance.now() + 30_000, async (session, check) => {
      const rows = await this.store.scan("DataImportRun", {}, session);
      rows.sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime()
        || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0));
      const result: ImportRunSummary[] = [];
      for (const row of rows) {
        check();
        const count = await this.store.collection("OperationSourceRecord").countDocuments({ importRunId: row.id }, { session });
        result.push(presentImportRun(presentation(row) as unknown as ImportRunPresentationRow, count));
      }
      return result;
    }));
  }

  async getImportRunById(value: string): Promise<ImportRunDetail | null> {
    return this.safe(() => this.transaction(performance.now() + 30_000, async (session, check) => {
      const id = uuid(value);
      const run = await this.store.one("DataImportRun", { _id: id }, session);
      if (!run) return null;
      const rows = await this.store.scan("OperationSourceRecord", { importRunId: id }, session);
      // Match the privacy wrapper's decrypted nested ordering before take:200.
      // No business tie-breaker is added for equal sheet/row-number ranks.
      rows.sort((a, b) => String(a.sourceSheet).localeCompare(String(b.sourceSheet), "ko") || Number(a.sourceRowNumber) - Number(b.sourceRowNumber));
      const records = [];
      for (const row of rows.slice(0, 200)) {
        check();
        let operationSession: SourceRecordPresentationRow["operationSession"] = null;
        if (row.operationSessionId !== null) {
          const operation = await this.store.one("OperationSession", { _id: row.operationSessionId as string }, session);
          assertMongo(operation, "IMPORT_MISSING_OPERATION");
          const course = await this.store.one("Course", { _id: operation.courseRecordId as string }, session);
          assertMongo(course, "IMPORT_MISSING_COURSE");
          const company = await this.store.one("Company", { _id: course.companyId as string }, session);
          assertMongo(company, "IMPORT_MISSING_COMPANY");
          operationSession = { operationId: operation.operationId as string, startDate: operation.startDate as Date, endDate: operation.endDate as Date,
            course: { name: course.name as string, company: { name: company.name as string } } };
        }
        records.push(toSourceRecordPreview({ ...presentation(row), operationSession } as SourceRecordPresentationRow));
      }
      return { ...presentImportRun(presentation(run) as unknown as ImportRunPresentationRow, rows.length), records };
    }));
  }

  async storeParsedImport(input: StoreImportInput): Promise<StoreImportResult> {
    return this.safe(async () => {
      const deadline = performance.now() + 60_000;
      // Resolve both ports before any IO. This never chooses a local/PG/Notion
      // fallback, including when the adapter is accidentally called out of scope.
      const members = getDataRepositoryOverride("teamMembers");
      const instructors = getDataRepositoryOverride("instructorNote");
      assertMongo(members && instructors, "IMPORT_ROSTER_SCOPE_REQUIRED");
      const roster = await members.listRoleRosters();
      const notes = await instructors.listNotes();
      const instructorNames = Array.from(new Set(notes.map(note => (note.displayName || note.instructorName || "").trim()).filter(Boolean)));
      const rows = validateImportRows(input.parsed.rows, roster, instructorNames);
      const runId = randomUUID();
      return this.transaction(deadline, async (session, check) => {
        // Authenticate the public source-type candidate set before narrowing by
        // HMAC. Otherwise a changed index key (or a removed companion) can turn
        // an existing source into an apparent miss and silently duplicate rows.
        // This deliberately uses the existing bounded scan, not a new key table.
        const authenticatedRuns = await this.store.scan("DataImportRun", { sourceType: input.sourceType }, session);
        const candidates = await this.store.scan("DataImportRun", {
          sourceNamePiiIndex: mongoRuntimeBlindIndex("DataImportRun", "sourceName", input.sourceName), sourceType: input.sourceType
        }, session);
        assertMongo(candidates.every(row => row.sourceName === input.sourceName), "IMPORT_SOURCE_EQUALITY_MISMATCH");
        const expectedIds = authenticatedRuns.filter(row => row.sourceName === input.sourceName).map(row => String(row.id)).sort();
        assertMongo(JSON.stringify(expectedIds) === JSON.stringify(candidates.map(row => String(row.id)).sort()), "IMPORT_SOURCE_EQUALITY_MISMATCH");
        const existing = candidates.length === 0 || rows.length === 0 ? [] : await this.store.scan("OperationSourceRecord", {
          importRunId: { $in: candidates.map(row => row.id as string) }, sourceTeam: input.sourceTeam,
          sourceFingerprint: { $in: rows.map(row => row.sourceFingerprint) }
        }, session);
        const planned = planImportRows(rows, new Set(existing.map(row => row.sourceFingerprint).filter((value): value is string => typeof value === "string" && Boolean(value))));
        const now = new Date();
        const run = completeMongoRow("DataImportRun", {
          id: runId, sourceTeam: input.sourceTeam, sourceType: input.sourceType, sourceName: input.sourceName,
          workbookName: input.sourceWorkbook, fileName: input.fileName ?? null, importedBy: input.importedBy,
          startedAt: now, finishedAt: now, rowCount: rows.length, successCount: planned.successCount,
          errorCount: planned.errorCount, status: planned.errorCount > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
          validationLogs: planned.validationLogs
        });
        await this.store.collection("DataImportRun").insertOne(encodeMongoRuntimeDocument("DataImportRun", run), { session });
        for (const row of planned.rowsToStore) {
          check();
          const record = completeMongoRow("OperationSourceRecord", {
            id: randomUUID(), importRunId: runId, operationSessionId: null, createdAt: now,
            sourceTeam: input.sourceTeam, sourceWorkbook: input.sourceWorkbook, sourceSheet: input.sourceSheet,
            sourceRowNumber: row.rowNumber, headerRowNumber: input.parsed.headerRowNumber,
            sourceFingerprint: row.sourceFingerprint, rowSnapshot: row.rowSnapshot, mappedFields: row.mappedFields,
            unmappedFields: row.unmappedFields, validationErrors: row.validationErrors
          });
          await this.store.collection("OperationSourceRecord").insertOne(encodeMongoRuntimeDocument("OperationSourceRecord", record), { session });
        }
        // These two source tables are excluded from common mutation auditing.
        // The real withActivity boundary records a separate request audit.
        return { id: runId, duplicateCount: planned.duplicateCount, errorCount: planned.errorCount, rowCount: rows.length, storedCount: planned.rowsToStore.length };
      });
    });
  }
}
