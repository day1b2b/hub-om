import { randomUUID } from "node:crypto";
import { BSON, MongoServerError, type ClientSession, type Filter } from "mongodb";
import type { CoachContentRepository, CoachContentAuthor, CoachContentRecord, CoachContentFeed } from "./coachContentRepository";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MONGO_SCAN_BYTES, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { assertMongoCoachSchedulingGuardReady, lockMongoCoachScheduling, prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";
import { operationAuditRow } from "./mongoOperationAudit";

export const COACH_CONTENT_MODELS = ["Coach", "CoachContentEntry", "CoachEngagement", "CoachScheduleAccessLog", "ActivityChange"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
const summary = (value: string) => { const text = value.trim(); return text.length > 40 ? `${text.slice(0, 40)}…` : text; };
const record = (row: MongoRow): CoachContentRecord => ({
  id: row.id as string, coachId: row.coachId as string, kind: row.kind as CoachContentRecord["kind"], content: row.content as string,
  authorEmail: row.authorEmail as string | null, authorName: row.authorName as string | null, sourceField: row.sourceField as string | null,
  flaggedAt: row.flaggedAt as Date | null, createdAt: row.createdAt as Date, updatedAt: row.updatedAt as Date, deletedAt: row.deletedAt as Date | null
});
export async function prepareMongoCoachContentStore(options: Options) {
  await prepareMongoReadStore(options, COACH_CONTENT_MODELS);
  await prepareMongoCoachSchedulingGuard(new MongoOperationStore(options, COACH_CONTENT_MODELS), options.allowShadowWrites);
}

/** Explicit synthetic-shadow backend; never selected from environment variables. */
export class MongoCoachContentRepository implements CoachContentRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, COACH_CONTENT_MODELS);
    try {
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      await assertMongoReadStoreReady(store);
      await assertMongoCoachSchedulingGuardReady(store);
      return new MongoCoachContentRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_CONTENT_OPEN_FAILED"); }
  }
  private async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.store.client.startSession();
    try { return await session.withTransaction(() => work(session), { readConcern: { level: "snapshot" }, readPreference: "primary", timeoutMS: 30_000 }); }
    catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("COACH_CONTENT_READ_FAILED"); }
    finally { await session.endSession(); }
  }
  private async write<T>(coachId: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          // Purge takes catalog then this guard. This writer never acquires catalog later.
          await lockMongoCoachScheduling(this.store, coachId, session);
          assertMongo(await this.store.one("Coach", { _id: coachId }, session), "COACH_NOT_FOUND");
          return work(session);
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 60_000 });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
        if (error instanceof MongoOperationError) throw error;
        throw new MongoOperationError("COACH_CONTENT_WRITE_FAILED");
      } finally { await session.endSession(); }
    }
    throw new MongoOperationError("COACH_CONTENT_RETRY_LIMIT");
  }
  private async audit(before: MongoRow | null, after: MongoRow, session: ClientSession) {
    const audit = operationAuditRow("CoachContentEntry", before, after);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
  }
  private async insert(row: MongoRow, session: ClientSession) {
    await this.store.collection("CoachContentEntry").insertOne(encodeMongoRuntimeDocument("CoachContentEntry", row), { session });
    await this.audit(null, row, session);
  }
  private async history(coachId: string, content: string, author: CoachContentAuthor, session: ClientSession) {
    const now = new Date();
    await this.insert(completeMongoRow("CoachContentEntry", { id: randomUUID(), coachId, kind: "EDIT_HISTORY", content, authorEmail: author.email, authorName: author.name, sourceField: "coach_content_entries.note", createdAt: now, updatedAt: now }), session);
  }
  async listNotes(input: string) {
    return this.read(async session => (await this.store.scan("CoachContentEntry", { coachId: input.toLowerCase(), kind: "NOTE", deletedAt: null }, session))
      .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
      .map(row => { const note = record(row); return { id: note.id, content: note.content, authorName: note.authorName, flaggedAt: note.flaggedAt, createdAt: note.createdAt }; }));
  }
  async createNote(input: string, content: string, author: CoachContentAuthor) {
    const coachId = input.toLowerCase();
    return this.write(coachId, async session => {
      const now = new Date();
      const row = completeMongoRow("CoachContentEntry", { id: randomUUID(), coachId, kind: "NOTE", content, authorEmail: author.email, authorName: author.name, createdAt: now, updatedAt: now });
      await this.insert(row, session);
      await this.history(coachId, `메모 작성: ${summary(content)}`, author, session);
      return record(row);
    });
  }
  private async change(input: string, noteId: string, author: CoachContentAuthor, action: "update" | "delete" | "toggle", content?: string) {
    const coachId = input.toLowerCase();
    return this.write(coachId, async session => {
      const before = await this.store.one("CoachContentEntry", { _id: noteId.toLowerCase(), coachId }, session);
      assertMongo(before, "COACH_CONTENT_NOT_FOUND");
      const now = new Date();
      const row = completeMongoRow("CoachContentEntry", { ...before, updatedAt: now, ...(action === "update" ? { content } : action === "delete" ? { deletedAt: now } : { flaggedAt: before.flaggedAt ? null : now }) });
      const result = await this.store.collection("CoachContentEntry").replaceOne({ _id: row.id as string, coachId }, encodeMongoRuntimeDocument("CoachContentEntry", row), { session });
      assertMongo(result.matchedCount === 1, "COACH_CONTENT_NOT_FOUND");
      await this.audit(before, row, session);
      const label = action === "update" ? "수정" : action === "delete" ? "삭제" : row.flaggedAt ? "경고 설정" : "경고 해제";
      await this.history(coachId, `메모 ${label}: ${summary(row.content as string)}`, author, session);
      return record(row);
    });
  }
  updateNote(coachId: string, noteId: string, content: string, author: CoachContentAuthor) { return this.change(coachId, noteId, author, "update", content); }
  deleteNote(coachId: string, noteId: string, author: CoachContentAuthor) { return this.change(coachId, noteId, author, "delete"); }
  toggleNoteWarning(coachId: string, noteId: string, author: CoachContentAuthor) { return this.change(coachId, noteId, author, "toggle"); }
  private async latest(model: string, filter: Filter<MongoRuntimeDocument>, session: ClientSession) {
    const rows: MongoRow[] = []; let bytes = 0;
    const deadline = performance.now() + 15_000;
    let previous: MongoRuntimeDocument | undefined;
    while (rows.length < 300) {
      const remaining = Math.ceil(deadline - performance.now()); assertMongo(remaining > 0, "SCAN_TIMEOUT");
      const next = previous ? { $and: [filter, { $or: [{ createdAt: { $lt: previous.createdAt } }, { createdAt: previous.createdAt, _id: { $gt: previous._id } }] }] } : filter;
      const size = Math.min(100, 300 - rows.length);
      const cursor = this.store.collection(model).find(next, { session, maxTimeMS: remaining, singleBatch: true, batchSize: size, collation: { locale: "simple" } }).sort({ createdAt: -1, _id: 1 }).limit(size);
      let count = 0;
      try { for await (const row of cursor) { count++; previous = row; bytes += BSON.calculateObjectSize(row); assertMongo(bytes <= MONGO_SCAN_BYTES, "SCAN_LIMIT_EXCEEDED"); rows.push(decodeMongoRuntimeDocument(model, row)); } }
      finally { await cursor.close(); }
      assertMongo(performance.now() <= deadline, "SCAN_TIMEOUT");
      if (count === 0) break;
    }
    return rows;
  }
  async getContentFeed(): Promise<CoachContentFeed> {
    return this.read(async session => {
      const entries = await this.latest("CoachContentEntry", { kind: "NOTE", deletedAt: null }, session);
      const reviews = await this.latest("CoachEngagement", { $or: [{ rating: { $ne: null } }, { feedback: { $ne: null } }] }, session);
      const ids = [...new Set([...entries, ...reviews].map(row => row.coachId as string))];
      const coaches = new Map((await this.store.scan("Coach", { _id: { $in: ids } }, session)).map(row => [row.id, { id: row.id as string, name: row.name as string }]));
      const coach = (row: MongoRow) => { const value = coaches.get(row.coachId); assertMongo(value, "COACH_CONTENT_ORPHAN"); return value; };
      return {
        entries: entries.map(row => { const note = record(row); return { id: note.id, kind: note.kind, content: note.content, authorName: note.authorName, sourceField: note.sourceField, flaggedAt: note.flaggedAt, createdAt: note.createdAt, coach: coach(row) }; }),
        reviewedEngagements: reviews.map(row => ({ id: row.id as string, rating: row.rating as number | null, feedback: row.feedback as string | null, courseName: row.courseName as string, createdAt: row.createdAt as Date, reviewFlaggedAt: row.reviewFlaggedAt as Date | null, coach: coach(row) }))
      };
    });
  }
  private async registration(yearMonth: string, session: ClientSession) {
    const coaches = (await this.store.scan("Coach", { status: "ACTIVE", deletedAt: null }, session)).sort((a, b) => (a.normalizedName as string).localeCompare(b.normalizedName as string, "ko"));
    const logs = await this.store.scan("CoachScheduleAccessLog", { yearMonth }, session);
    return { coaches, logs };
  }
  async getScheduleRegistration(yearMonth: string) {
    return this.read(async session => { const { coaches, logs } = await this.registration(yearMonth, session); return {
      coaches: coaches.map(row => ({ id: row.id as string, name: row.name as string, workType: row.workType as string | null, accessToken: row.accessToken as string | null })),
      accessLogs: logs.map(row => ({ coachId: row.coachId as string, lastEditedAt: row.lastEditedAt as Date | null }))
    }; });
  }
  async getScheduleStatus(yearMonth: string) {
    return this.read(async session => { const { coaches, logs } = await this.registration(yearMonth, session); return {
      activeCoaches: coaches.map(row => ({ id: row.id as string, name: row.name as string })),
      accessLogs: logs.map(row => ({ coachId: row.coachId as string, accessedAt: row.accessedAt as Date, lastEditedAt: row.lastEditedAt as Date | null }))
    }; });
  }
}
