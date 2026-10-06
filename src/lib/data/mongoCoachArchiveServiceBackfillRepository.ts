import { randomUUID } from "node:crypto";
import { BSON, MongoServerError, type ClientSession, type Document } from "mongodb";
import type { CoachArchiveServiceBackfillRepository, CoachArchiveServiceBackfillSummary } from "./coachArchiveServiceBackfillRepository";
import { archiveNullableTimestamp, archiveObject, archiveRequiredTimestamp, archiveStringOrNull, coachArchivePatch, sameArchiveValue } from "./coachArchiveServiceBackfillValues";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";

export const COACH_ARCHIVE_SERVICE_BACKFILL_MODELS = ["Coach", "CoachScheduleAccessLog", "CoachdbArchiveRow", "CoachdbArchiveSnapshot", "ActivityChange"] as const;
export type MongoCoachArchiveServiceBackfillOptions = MongoOperationOptions & { allowShadowWrites: true };
const TIMEOUT_MS = 120_000;
const PAGE_SIZE = 250;
const PAGE_BYTES = 32 * 1024 * 1024;
const COACH_FIELDS = ["accessToken", "statusNote", "returnDate", "selfNote", "portfolioUrl", "availabilityDetail", "managerNote", "dxTag", "deletedBy"] as const;
const STORED_FIELDS = ["accessToken", "accessTokenPiiIndex", "statusNote", "statusNotePiiIndex", "returnDate", "returnDateEncrypted", "selfNote", "selfNotePiiIndex", "portfolioUrl", "portfolioUrlPiiIndex", "availabilityDetail", "availabilityDetailPiiIndex", "managerNote", "managerNotePiiIndex", "dxTag", "dxTagPiiIndex", "deletedBy", "deletedByPiiIndex", "updatedAt"] as const;

export async function prepareMongoCoachArchiveServiceBackfillStore(options: MongoCoachArchiveServiceBackfillOptions): Promise<void> {
  try { await prepareMongoReadStore(options, COACH_ARCHIVE_SERVICE_BACKFILL_MODELS); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_ARCHIVE_SERVICE_BACKFILL_PREPARE_FAILED"); }
}

export class MongoCoachArchiveServiceBackfillRepository implements CoachArchiveServiceBackfillRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoCoachArchiveServiceBackfillOptions) {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COACH_ARCHIVE_SERVICE_BACKFILL_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCoachArchiveServiceBackfillRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_ARCHIVE_SERVICE_BACKFILL_OPEN_FAILED"); }
  }

  private deadline(deadline: number) { assertMongo(performance.now() < deadline, "COACH_ARCHIVE_SERVICE_BACKFILL_TIMEOUT"); }

  private async page(model: "Coach" | "CoachdbArchiveRow", pipeline: Document[], session: ClientSession, deadline: number) {
    this.deadline(deadline);
    const maxTimeMS = Math.ceil(deadline - performance.now());
    const cursor = this.store.collection(model).aggregate<Document>([...pipeline, { $limit: PAGE_SIZE }], {
      session, batchSize: PAGE_SIZE, collation: { locale: "simple" }, allowDiskUse: false, maxTimeMS,
    });
    try {
      const rows: Document[] = []; let bytes = 0;
      for await (const row of cursor) {
        assertMongo(rows.length < PAGE_SIZE, "COACH_ARCHIVE_SERVICE_PAGE_LIMIT");
        bytes += BSON.calculateObjectSize(row); assertMongo(bytes <= PAGE_BYTES, "COACH_ARCHIVE_SERVICE_PAGE_LIMIT");
        rows.push(row);
      }
      this.deadline(deadline); return rows;
    } finally { await cursor.close(); }
  }

  private latestPipeline(tableName: string): Document[] {
    return [
      { $match: { tableSchema: "public", tableName } },
      { $replaceWith: { row: "$$ROOT" } },
      { $lookup: {
        from: this.store.collection("CoachdbArchiveSnapshot").collectionName,
        localField: "row.snapshotId", foreignField: "_id",
        pipeline: [{ $match: { status: "completed" } }], as: "snapshot",
      } },
      { $unwind: "$snapshot" },
      { $sort: { "row.rowKeyPiiIndex": 1, "snapshot.startedAt": -1, "row._id": -1 } },
      { $group: { _id: "$row.rowKeyPiiIndex", document: { $first: "$row" } } },
    ];
  }

  private async latestForSources(tableName: string, sourceIds: string[], session: ClientSession, deadline: number) {
    const sourceSet = new Set(sourceIds), indexes = sourceIds.map(value => mongoRuntimeBlindIndex("CoachdbArchiveRow", "rowKey", value));
    const latest = new Map<string, MongoRow>();
    let afterIndex: string | undefined;
    for (;;) {
      const documents = await this.page("CoachdbArchiveRow", [
        { $match: { tableSchema: "public", tableName, rowKeyPiiIndex: { $in: indexes } } },
        ...this.latestPipeline(tableName).slice(1),
        ...(afterIndex ? [{ $match: { _id: { $gt: afterIndex } } }] : []),
        { $sort: { _id: 1 } },
      ], session, deadline);
      if (!documents.length) break;
      for (const result of documents) {
        const row = decodeMongoRuntimeDocument("CoachdbArchiveRow", result.document);
        assertMongo(sourceSet.has(row.rowKey as string), "PRIVATE_EQUALITY_MISMATCH");
        latest.set(row.rowKey as string, row);
      }
      if (latest.size === sourceSet.size) break;
      afterIndex = String(documents.at(-1)!._id);
    }
    return latest;
  }

  private async latestArchivePage(tableName: string, afterIndex: string | undefined, session: ClientSession, deadline: number) {
    // Read at most one bounded index page, then de-duplicate it locally. Advancing
    // past the final HMAC intentionally skips the rest of that key's history; the
    // second query below selects its latest completed row.
    const keyRows = await this.page("CoachdbArchiveRow", [
      { $match: { tableSchema: "public", tableName, rowKeyPiiIndex: afterIndex ? { $gt: afterIndex } : { $type: "string" } } },
      { $sort: { rowKeyPiiIndex: 1 } },
      { $project: { _id: 0, rowKeyPiiIndex: 1 } },
    ], session, deadline);
    if (!keyRows.length) return { documents: [] as Document[], nextIndex: undefined };
    const indexes = [...new Set(keyRows.map(row => String(row.rowKeyPiiIndex)))];
    const documents = await this.page("CoachdbArchiveRow", [
      { $match: { tableSchema: "public", tableName, rowKeyPiiIndex: { $in: indexes } } },
      ...this.latestPipeline(tableName).slice(1),
      { $sort: { _id: 1 } },
    ], session, deadline);
    return { documents, nextIndex: String(keyRows.at(-1)!.rowKeyPiiIndex) };
  }

  async backfill({ apply }: { apply: boolean }): Promise<CoachArchiveServiceBackfillSummary> {
    try {
      const deadline = performance.now() + TIMEOUT_MS, session = this.store.client.startSession();
      try {
        for (let attempt = 0; attempt < 5; attempt++) try {
          return await session.withTransaction(async () => {
          const summary: CoachArchiveServiceBackfillSummary = { coachRows: 0, changedCoaches: 0, accessLogRows: 0, updatedCoaches: 0, upsertedAccessLogs: 0 };
          let coachCursor: string | undefined;
          for (;;) {
            const documents = await this.page("Coach", [
              { $match: coachCursor ? { _id: { $gt: coachCursor } } : {} }, { $sort: { _id: 1 } },
            ], session, deadline);
            if (!documents.length) break;
            const coaches = documents.map(document => decodeMongoRuntimeDocument("Coach", document));
            const archivedCoaches = await this.latestForSources("coaches", coaches.map(coach => coach.sourceCoachId as string), session, deadline);
            for (const coach of coaches) {
              this.deadline(deadline);
              const archive = archivedCoaches.get(coach.sourceCoachId as string); if (!archive) continue;
              summary.coachRows++;
              const row = archiveObject(archive.rowData); assertMongo(row, "COACH_ARCHIVE_SERVICE_INVALID_COACH_ROW");
              let patch: ReturnType<typeof coachArchivePatch>;
              try { patch = coachArchivePatch(row); } catch { throw new MongoOperationError("COACH_ARCHIVE_SERVICE_INVALID_COACH_ROW"); }
              if (!COACH_FIELDS.some(field => !sameArchiveValue(coach[field], patch[field]))) continue;
              summary.changedCoaches++;
              if (!apply) continue;
              const next = completeMongoRow("Coach", { ...coach, ...patch, updatedAt: new Date() });
              const encoded = encodeMongoRuntimeDocument("Coach", next), stored = Object.fromEntries(STORED_FIELDS.map(field => [field, encoded[field]]));
              const result = await this.store.collection("Coach").updateOne({ _id: coach.id as string }, { $set: stored }, { session });
              assertMongo(result.matchedCount === 1, "COACH_ARCHIVE_SERVICE_COACH_DISAPPEARED");
              const audit = operationAuditRow("Coach", coach, next);
              if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
              summary.updatedCoaches++;
            }
            coachCursor = coaches.at(-1)!.id as string;
          }

          let logCursor: string | undefined;
          for (;;) {
            const page = await this.latestArchivePage("schedule_access_logs", logCursor, session, deadline);
            if (!page.nextIndex) break;
            const documents = page.documents;
            const archives = documents.map(document => decodeMongoRuntimeDocument("CoachdbArchiveRow", document.document));
            summary.accessLogRows += archives.length;
            const sources = new Set<string>();
            for (const archive of archives) {
              const row = archiveObject(archive.rowData); assertMongo(row, "COACH_ARCHIVE_SERVICE_INVALID_ACCESS_LOG");
              try { const source = archiveStringOrNull(row.coach_id, "coach_id"); if (source !== null) sources.add(source); }
              catch { throw new MongoOperationError("COACH_ARCHIVE_SERVICE_INVALID_ACCESS_LOG"); }
            }
            const coachIndexes = [...sources].map(source => mongoRuntimeBlindIndex("Coach", "sourceCoachId", source));
            const coachRows = coachIndexes.length ? await this.store.scan("Coach", { sourceCoachIdPiiIndex: { $in: coachIndexes } }, session) : [];
            const coaches = new Map<string, MongoRow>();
            for (const coach of coachRows) { assertMongo(sources.has(coach.sourceCoachId as string), "PRIVATE_EQUALITY_MISMATCH"); coaches.set(coach.sourceCoachId as string, coach); }
            for (const archive of archives) {
              this.deadline(deadline);
              const row = archiveObject(archive.rowData)!; if (row.year_month == null) continue;
              let sourceCoachId: string | null;
              try { sourceCoachId = archiveStringOrNull(row.coach_id, "coach_id"); }
              catch { throw new MongoOperationError("COACH_ARCHIVE_SERVICE_INVALID_ACCESS_LOG"); }
              if (sourceCoachId === null) continue;
              const coach = coaches.get(sourceCoachId); if (!coach) continue;
              let yearMonth: string | null, accessedAt: Date, lastEditedAt: Date | null;
              try {
                yearMonth = archiveStringOrNull(row.year_month, "year_month");
                accessedAt = archiveRequiredTimestamp(row.accessed_at, "accessed_at"); lastEditedAt = archiveNullableTimestamp(row.last_edited_at, "last_edited_at");
              } catch { throw new MongoOperationError("COACH_ARCHIVE_SERVICE_INVALID_ACCESS_LOG"); }
              if (yearMonth === null || !apply) continue;
              const current = await this.store.one("CoachScheduleAccessLog", { coachId: coach.id as string, yearMonth }, session);
              const next = completeMongoRow("CoachScheduleAccessLog", { ...(current ?? { id: randomUUID(), coachId: coach.id, yearMonth }), sourceAccessLogId: archive.rowKey, accessedAt, lastEditedAt });
              const encoded = encodeMongoRuntimeDocument("CoachScheduleAccessLog", next);
              if (current) {
                const result = await this.store.collection("CoachScheduleAccessLog").replaceOne({ _id: current.id as string }, encoded, { session });
                assertMongo(result.matchedCount === 1, "COACH_ARCHIVE_SERVICE_ACCESS_LOG_DISAPPEARED");
              } else await this.store.collection("CoachScheduleAccessLog").insertOne(encoded, { session });
              summary.upsertedAccessLogs++;
            }
            logCursor = page.nextIndex;
          }
          this.deadline(deadline); return summary;
          }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", maxCommitTimeMS: TIMEOUT_MS });
        } catch (error) {
          // Concurrent first upserts can surface as an unlabeled duplicate-key error.
          // Restart the complete snapshot transaction and observe the winner.
          if (apply && error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
          throw error;
        }
        throw new MongoOperationError("COACH_ARCHIVE_SERVICE_BACKFILL_RETRY_EXHAUSTED");
      } finally { await session.endSession(); }
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_ARCHIVE_SERVICE_BACKFILL_FAILED"); }
  }
}
