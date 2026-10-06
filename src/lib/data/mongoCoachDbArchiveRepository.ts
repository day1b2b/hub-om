import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { CoachDbArchiveInput, CoachDbArchiveRepository } from "./coachDbArchiveRepository";
import { summarizeCoachDbArchive } from "./coachDbArchiveRepository";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
export const COACH_DB_ARCHIVE_MODELS = ["CoachdbArchiveSnapshot", "CoachdbArchiveRow"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export async function prepareMongoCoachDbArchiveStore(options: Options) { await prepareMongoReadStore(options, COACH_DB_ARCHIVE_MODELS); }
export class MongoCoachDbArchiveRepository implements CoachDbArchiveRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) { try { assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE"); const store = new MongoOperationStore(options, COACH_DB_ARCHIVE_MODELS);
    const hello = await store.db.command({ hello: 1 }); assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
    await assertMongoReadStoreReady(store); return new MongoCoachDbArchiveRepository(store); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_DB_ARCHIVE_OPEN_FAILED"); } }
  private async write(input: CoachDbArchiveInput, session: ClientSession) {
    const summary = summarizeCoachDbArchive(input), snapshotId = randomUUID(), startedAt = new Date();
    const snapshot = completeMongoRow("CoachdbArchiveSnapshot", { id: snapshotId, sourceDatabase: input.sourceDatabase, sourceSchema: input.sourceSchema,
      tableCount: 0, rowCount: 0, status: "running", errorMessage: null, startedAt, finishedAt: null });
    await this.store.collection("CoachdbArchiveSnapshot").insertOne(encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", snapshot), { session });
    for (const table of input.tables) for (let offset = 0; offset < table.rows.length; offset += 250) {
      const now = new Date(), documents = table.rows.slice(offset, offset + 250).map(row => encodeMongoRuntimeDocument("CoachdbArchiveRow", completeMongoRow("CoachdbArchiveRow", {
        id: randomUUID(), snapshotId, tableSchema: table.schema, tableName: table.name, rowKey: row.rowKey, rowData: row.rowData, archivedAt: now })));
      if (documents.length) await this.store.collection("CoachdbArchiveRow").insertMany(documents, { session, ordered: true });
    }
    const completed = completeMongoRow("CoachdbArchiveSnapshot", { ...snapshot, tableCount: summary.tableCount, rowCount: summary.rowCount, status: "completed", finishedAt: new Date() });
    const result = await this.store.collection("CoachdbArchiveSnapshot").replaceOne({ _id: snapshotId, status: "running" }, encodeMongoRuntimeDocument("CoachdbArchiveSnapshot", completed), { session });
    assertMongo(result.matchedCount === 1, "SNAPSHOT_CHANGED"); return summary;
  }
  async archive(input: CoachDbArchiveInput, apply: boolean) { if (!apply) return summarizeCoachDbArchive(input); const session = this.store.client.startSession();
    try { return await session.withTransaction(() => this.write(input, session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 300_000 }); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_DB_ARCHIVE_FAILED"); }
    finally { await session.endSession(); } }
}
