import { randomUUID } from "node:crypto";
import { MongoServerError, type ClientSession } from "mongodb";
import type { InstructorNote, InstructorNoteRepository, InstructorNotionProfile } from "./instructorNoteRepository";
import { stripPiiFromNote } from "./instructorNotePii";
import { encodeMongoRuntimeDocument, MongoDbNull } from "./mongoRuntimeCodec";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady } from "./mongoReadStore";
import { operationAuditRow } from "./mongoOperationAudit";

export const INSTRUCTOR_NOTE_MODELS = ["InstructorNote", "ActivityChange"] as const;

function toNote(row: MongoRow | null): InstructorNote {
  if (!row) return {};
  const result: InstructorNote = { recruitAvoid: row.recruitAvoid as boolean, instructorName: row.instructorName as string };
  if (row.notionNo !== null) result.notionNo = row.notionNo as number;
  for (const field of ["displayName", "notionId", "partnerId", "notes"] as const) {
    if (row[field]) result[field] = row[field] as string;
  }
  if (row.notionProfile && typeof row.notionProfile === "object" && !Array.isArray(row.notionProfile)) {
    result.notion = row.notionProfile as InstructorNotionProfile;
  }
  return result;
}

// Match PostgreSQL ascending Int NULLS LAST. Read-by-name explicitly prefers the null row;
// legacy save-by-name instead updates the lowest numbered row. Preserve both existing contracts.
function byNotionNo(a: MongoRow, b: MongoRow): number {
  return a.notionNo === null ? (b.notionNo === null ? 0 : 1) : b.notionNo === null ? -1 : Number(a.notionNo) - Number(b.notionNo);
}

function patchFields(patch: InstructorNote): MongoRow {
  const fields: MongoRow = {};
  for (const key of ["instructorName", "notionNo", "recruitAvoid"] as const) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }
  for (const key of ["displayName", "notionId", "partnerId", "notes"] as const) {
    if (patch[key] !== undefined) fields[key] = patch[key] || null;
  }
  if (patch.notion !== undefined) {
    fields.notionProfile = patch.notion ?? MongoDbNull;
    fields.notionSyncedAt = patch.notion?.syncedAt ? new Date(patch.notion.syncedAt) : null;
  }
  return fields;
}

/** Parallel validation only: explicit shadow writes, no production factory/environment fallback. */
export class MongoInstructorNoteRepository implements InstructorNoteRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoOperationOptions & { allowShadowWrites: true }): Promise<MongoInstructorNoteRepository> {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    const store = new MongoOperationStore(options, INSTRUCTOR_NOTE_MODELS);
    try {
      await assertMongoReadStoreReady(store);
      const hello = await store.db.command({ hello: 1 });
      assertMongo((typeof hello.setName === "string" || hello.msg === "isdbgrid") && typeof hello.logicalSessionTimeoutMinutes === "number", "TRANSACTIONS_REQUIRED");
      return new MongoInstructorNoteRepository(store);
    } catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("INSTRUCTOR_NOTE_OPEN_FAILED");
    }
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof MongoOperationError) throw error;
      throw new MongoOperationError("INSTRUCTOR_NOTE_FAILED");
    }
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.safe(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const session = this.store.client.startSession();
        try {
          return await session.withTransaction(() => work(session), {
            readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: 30_000
          });
        } catch (error) {
          // A competing notionNo upsert may win; reread it in a fresh transaction.
          if (error instanceof MongoServerError && error.code === 11000 && attempt < 4) continue;
          throw error;
        } finally { await session.endSession(); }
      }
      throw new MongoOperationError("RETRY_LIMIT");
    });
  }

  async getNote(name: string): Promise<InstructorNote> {
    return this.safe(async () => {
      const rows = (await this.store.findPrivateEqual("InstructorNote", "instructorName", name)).sort(byNotionNo);
      return toNote(rows.find(row => row.notionNo === null) ?? rows[0] ?? null);
    });
  }

  async getNoteByNotionNo(notionNo: number): Promise<InstructorNote> {
    return this.safe(async () => toNote(await this.store.one("InstructorNote", { notionNo })));
  }

  async listNotes(): Promise<InstructorNote[]> {
    return this.safe(async () => (await this.store.scan("InstructorNote")).map(toNote));
  }

  private async save(previous: MongoRow | null, fields: MongoRow, session: ClientSession): Promise<InstructorNote> {
    const now = new Date();
    const row = completeMongoRow("InstructorNote", previous
      ? { ...previous, ...fields, updatedAt: now }
      : { id: randomUUID(), recruitAvoid: false, createdAt: now, updatedAt: now, ...fields });
    const document = encodeMongoRuntimeDocument("InstructorNote", row);
    if (previous) {
      const result = await this.store.collection("InstructorNote").replaceOne({ _id: previous.id as string }, document, { session });
      assertMongo(result.matchedCount === 1, "ROW_DISAPPEARED");
    } else await this.store.collection("InstructorNote").insertOne(document, { session });
    const audit = operationAuditRow("InstructorNote", previous, row);
    if (audit) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", audit), { session });
    return toNote(row);
  }

  async saveNoteByNotionNo(notionNo: number, patch: InstructorNote): Promise<InstructorNote> {
    return this.transaction(async session => {
      const safe = stripPiiFromNote(patch);
      const previous = await this.store.one("InstructorNote", { notionNo }, session);
      const fields = patchFields(safe);
      // Like PG upsert, the lookup NO is used on create; a supplied patch NO may change an existing row.
      return this.save(previous, previous ? fields : { instructorName: safe.instructorName ?? "", ...fields, notionNo }, session);
    });
  }

  async saveNote(name: string, patch: InstructorNote): Promise<InstructorNote> {
    return this.transaction(async session => {
      const safe = stripPiiFromNote(patch);
      const previous = (await this.store.findPrivateEqual("InstructorNote", "instructorName", name, session)).sort(byNotionNo)[0] ?? null;
      const fields = patchFields(safe);
      // Existing PG create-by-name ignores patch notionNo and instructorName. Names are not unique;
      // concurrent first-time name inserts may create separate rows, as in the current repository.
      if (!previous) { delete fields.notionNo; fields.instructorName = name; }
      return this.save(previous, fields, session);
    });
  }
}
