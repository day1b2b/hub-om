import { BSON, type ClientSession, type Document } from "mongodb";
import type { CoachTokenBackfillSummary } from "./coachAccessTokenBackfill";
import type { CoachTokenBackfillRepository } from "./coachTokenBackfillRepository";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";

export const COACH_TOKEN_BACKFILL_MODELS = ["Coach", "CoachdbArchiveRow", "CoachdbArchiveSnapshot", "ActivityChange"] as const;
export type MongoCoachTokenBackfillOptions = MongoOperationOptions & { allowShadowWrites: true };
const PAGE_SIZE = 250;
const PAGE_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export async function prepareMongoCoachTokenBackfillStore(options: MongoCoachTokenBackfillOptions): Promise<void> {
  try { await prepareMongoReadStore(options, COACH_TOKEN_BACKFILL_MODELS); }
  catch (error) {
    if (error instanceof MongoOperationError) throw error;
    throw new MongoOperationError("COACH_TOKEN_BACKFILL_PREPARE_FAILED");
  }
}

/** Explicit maintenance-only shadow adapter. Preparation is separate; opening and
 * dry runs never create collections, guards, audit rows, or update source rows.
 */
export class MongoCoachTokenBackfillRepository implements CoachTokenBackfillRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoCoachTokenBackfillOptions): Promise<MongoCoachTokenBackfillRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, COACH_TOKEN_BACKFILL_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoCoachTokenBackfillRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_TOKEN_BACKFILL_OPEN_FAILED");
    }
  }

  private checkDeadline(deadline: number): void {
    assertMongo(performance.now() < deadline, "COACH_TOKEN_BACKFILL_TIMEOUT");
  }

  /** Consume only aggregate firstBatch through public APIs. A BSON-short batch
   * is not EOF: the caller resumes after its actual last key until an empty page.
   * Never iterate the cursor: driver 7.2 getMore conflicts with transaction CSOT.
   */
  private async page(model: "Coach" | "CoachdbArchiveRow", pipeline: Document[], session: ClientSession, deadline: number): Promise<Document[]> {
    this.checkDeadline(deadline);
    const cursor = this.store.collection(model).aggregate<Document>([...pipeline, { $limit: PAGE_SIZE }], {
      session, batchSize: PAGE_SIZE, collation: { locale: "simple" }, allowDiskUse: false
    });
    try {
      const first = await cursor.next();
      const rows = first === null ? [] : [first, ...cursor.readBufferedDocuments()];
      assertMongo(rows.length <= PAGE_SIZE, "COACH_TOKEN_BACKFILL_PAGE_LIMIT");
      let bytes = 0;
      for (const row of rows) {
        bytes += BSON.calculateObjectSize(row);
        assertMongo(bytes <= PAGE_BYTES, "COACH_TOKEN_BACKFILL_PAGE_LIMIT");
      }
      this.checkDeadline(deadline);
      return rows;
    } finally { await cursor.close(); }
  }

  async backfill({ apply }: { apply: boolean }): Promise<CoachTokenBackfillSummary> {
    // The outer boundary also sanitizes startSession/endSession errors. Keep the
    // driver's transaction errors intact inside withTransaction for bounded retry.
    try {
      const deadline = performance.now() + TIMEOUT_MS;
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          const summary: CoachTokenBackfillSummary = { archivedTokens: 0, missingTokens: 0, changedTokens: 0, updatedTokens: 0 };
          let coachCursor: string | undefined;
          for (;;) {
            const documents = await this.page("Coach", [
              { $match: coachCursor === undefined ? {} : { _id: { $gt: coachCursor } } },
              { $sort: { _id: 1 } }
            ], session, deadline);
            if (!documents.length) break;
            const coaches = documents.map(document => decodeMongoRuntimeDocument("Coach", document));
            const sourceIds = new Set(coaches.map(coach => coach.sourceCoachId as string));
            const indexes = [...sourceIds].map(id => mongoRuntimeBlindIndex("CoachdbArchiveRow", "rowKey", id));
            const latest = new Map<string, string>();
            let tokenBytes = 0;
            let archiveCursor: { startedAt: Date; id: string } | undefined;
            for (;;) {
              const rows = await this.page("CoachdbArchiveRow", [
                { $match: { tableSchema: "public", tableName: "coaches", rowKeyPiiIndex: { $in: indexes } } },
                { $replaceWith: { row: "$$ROOT" } },
                { $lookup: {
                  from: this.store.collection("CoachdbArchiveSnapshot").collectionName,
                  localField: "row.snapshotId", foreignField: "_id",
                  pipeline: [{ $match: { status: "completed" } }], as: "snapshot"
                } },
                { $unwind: "$snapshot" },
                ...(archiveCursor ? [{ $match: { $or: [
                  { "snapshot.startedAt": { $lt: archiveCursor.startedAt } },
                  { "snapshot.startedAt": archiveCursor.startedAt, "row._id": { $lt: archiveCursor.id } }
                ] } }] : []),
                { $sort: { "snapshot.startedAt": -1, "row._id": -1 } }
              ], session, deadline);
              if (!rows.length) break;
              for (const document of rows) {
                this.checkDeadline(deadline);
                const row = decodeMongoRuntimeDocument("CoachdbArchiveRow", document.row);
                const snapshot = decodeMongoRuntimeDocument("CoachdbArchiveSnapshot", document.snapshot);
                assertMongo(row.snapshotId === snapshot.id && snapshot.status === "completed", "COACH_TOKEN_BACKFILL_SNAPSHOT_MISMATCH");
                const key = row.rowKey as string;
                assertMongo(sourceIds.has(key), "PRIVATE_EQUALITY_MISMATCH");
                archiveCursor = { startedAt: snapshot.startedAt as Date, id: row.id as string };
                if (latest.has(key)) continue;
                const data = row.rowData;
                if (!data || typeof data !== "object" || Array.isArray(data)) continue;
                const token = (data as Record<string, unknown>).access_token;
                if (token == null) continue;
                assertMongo(typeof token === "string", "COACH_TOKEN_BACKFILL_INVALID_TOKEN");
                tokenBytes += Buffer.byteLength(key, "utf8") + Buffer.byteLength(token, "utf8");
                assertMongo(tokenBytes <= PAGE_BYTES, "COACH_TOKEN_BACKFILL_PAGE_LIMIT");
                latest.set(key, token);
              }
              if (latest.size === sourceIds.size) break;
            }
            for (const coach of coaches) {
              this.checkDeadline(deadline);
              const token = latest.get(coach.sourceCoachId as string);
              if (token === undefined) continue;
              summary.archivedTokens++;
              if (coach.accessToken === null) summary.missingTokens++;
              if (coach.accessToken === token) continue;
              summary.changedTokens++;
              if (!apply) continue;
              const next = completeMongoRow("Coach", { ...coach, accessToken: token, updatedAt: new Date() });
              const encoded = encodeMongoRuntimeDocument("Coach", next);
              // Preserve every unrelated ciphertext and field byte-for-byte.
              const result = await this.store.collection("Coach").updateOne({ _id: coach.id as string }, { $set: {
                accessToken: encoded.accessToken, accessTokenPiiIndex: encoded.accessTokenPiiIndex, updatedAt: encoded.updatedAt
              } }, { session });
              assertMongo(result.matchedCount === 1, "COACH_TOKEN_BACKFILL_ROW_DISAPPEARED");
              const audit = operationAuditRow("Coach", coach, next);
              if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
              summary.updatedTokens++;
            }
            coachCursor = coaches[coaches.length - 1].id as string;
          }
          this.checkDeadline(deadline);
          return summary;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: TIMEOUT_MS });
      } finally { await session.endSession(); }
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("COACH_TOKEN_BACKFILL_FAILED");
    }
  }
}
