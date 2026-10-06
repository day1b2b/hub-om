import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { InstructorNote } from "./instructorNoteRepository";
import type { InstructorNoteImportEntry, InstructorNoteImportRepository } from "./instructorNoteImportRepository";
import { encodeMongoRuntimeDocument, MongoDbNull } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { lockMongoInstructorNote } from "./mongoInstructorNoteGuard";
export const INSTRUCTOR_NOTE_IMPORT_MODELS = ["InstructorNote"] as const;
type Options = MongoOperationOptions & { allowShadowWrites: true };
function byNotionNo(a: MongoRow, b: MongoRow) { return a.notionNo === null ? (b.notionNo === null ? 0 : 1) : b.notionNo === null ? -1 : Number(a.notionNo) - Number(b.notionNo); }
function text(value: string | undefined): string | undefined { const normalized = value?.trim(); return normalized ? normalized : undefined; }
function fields(note: InstructorNote, existing?: MongoRow): MongoRow {
  const result: MongoRow = { recruitAvoid: existing?.recruitAvoid === true || note.recruitAvoid === true };
  for (const field of ["displayName", "notionId", "partnerId", "notes"] as const) { const value = text(note[field]); if (value !== undefined) result[field] = value; }
  if (note.notion) { result.notionProfile = note.notion; if (note.notion.syncedAt) result.notionSyncedAt = new Date(note.notion.syncedAt); }
  return result;
}
export async function prepareMongoInstructorNoteImportStore(options: Options) { await prepareMongoReadStore(options, INSTRUCTOR_NOTE_IMPORT_MODELS); }
export class MongoInstructorNoteImportRepository implements InstructorNoteImportRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: Options) {
    try { assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE"); const store = new MongoOperationStore(options, INSTRUCTOR_NOTE_IMPORT_MODELS);
      const hello = await store.db.command({ hello: 1 }); assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store); return new MongoInstructorNoteImportRepository(store);
    } catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("INSTRUCTOR_NOTE_IMPORT_OPEN_FAILED"); }
  }
  private async execute(entries: readonly InstructorNoteImportEntry[], apply: boolean, session: ClientSession) {
    const current = await this.store.scan("InstructorNote", {}, session), byName = new Map<string, MongoRow[]>(), byNo = new Map<number, MongoRow>();
    for (const row of current) { const name = row.instructorName as string, rows = byName.get(name) ?? []; rows.push(row); byName.set(name, rows); if (row.notionNo !== null) byNo.set(row.notionNo as number, row); }
    for (const rows of byName.values()) rows.sort(byNotionNo);
    let inserted = 0, updated = 0;
    for (const { name, note } of entries) {
      const existing = note.notionNo !== undefined ? byNo.get(note.notionNo) : byName.get(name)?.[0], now = new Date();
      if (existing) { updated++; if (apply) { const row = completeMongoRow("InstructorNote", { ...existing, ...fields(note, existing), ...(note.notionNo !== undefined ? { instructorName: name } : {}), updatedAt: now });
        const result = await this.store.collection("InstructorNote").replaceOne({ _id: existing.id as string }, encodeMongoRuntimeDocument("InstructorNote", row), { session });
        assertMongo(result.matchedCount === 1, "ROW_DISAPPEARED"); if (note.notionNo !== undefined) byNo.set(note.notionNo, row); else byName.get(name)![0] = row; } }
      else { inserted++; if (apply) { const row = completeMongoRow("InstructorNote", { id: randomUUID(), notionNo: note.notionNo ?? null, instructorName: name,
        displayName: null, notionId: null, partnerId: null, notes: null, recruitAvoid: false, notionProfile: MongoDbNull, notionSyncedAt: null,
        createdAt: now, updatedAt: now, ...fields(note) }); await this.store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", row), { session }); if (note.notionNo !== undefined) byNo.set(note.notionNo, row); else byName.set(name, [row]); } }
    }
    return { total: entries.length, inserted, updated };
  }
  async importNotes(entries: readonly InstructorNoteImportEntry[], apply: boolean) {
    for (let attempt = 0; attempt < 5; attempt++) { const session = this.store.client.startSession(); try {
      return await session.withTransaction(async () => { if (apply) await lockMongoInstructorNote(this.store, session); return this.execute(entries, apply, session); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000 });
    } catch (error) { if (apply && error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue; if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("INSTRUCTOR_NOTE_IMPORT_FAILED"); }
    finally { await session.endSession(); } }
    throw new MongoOperationError("INSTRUCTOR_NOTE_IMPORT_CONCURRENT_CHANGE");
  }
}
