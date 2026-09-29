import { randomUUID } from "node:crypto";
import { BSON, type ClientSession, type Filter } from "mongodb";
import type { AnnouncementRepository, AnnouncementRecord, AnnouncementListRow, AnnouncementAttachmentRow, AnnouncementDetailRow, AnnouncementDetailPageRow, AnnouncementEditPageRow, AnnouncementUpdateState, AnnouncementDeleteState, AnnouncementFileInput } from "./announcements/announcementRepository";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MONGO_SCAN_ROWS, MongoOperationError, MongoOperationStore, type MongoOperationOptions, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, type MongoRuntimeDocument } from "./mongoRuntimeCodec";

export const ANNOUNCEMENT_MODELS = ["Announcement", "AnnouncementAttachment", "ActivityChange"] as const;
export type MongoAnnouncementOptions = MongoOperationOptions & { allowShadowWrites: true };
const ATTACHMENT_SCAN_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
export class MongoAnnouncementError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Mongo announcement operation failed: ${code}`); this.code = code; }
}
function safe(error: unknown, code: string): MongoAnnouncementError {
  if (error instanceof MongoAnnouncementError) return error;
  return new MongoAnnouncementError(error instanceof MongoOperationError ? error.code : code);
}
function uuid(value: string): string {
  if (typeof value !== "string") throw new MongoAnnouncementError("INVALID_UUID");
  const text = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(text)) throw new MongoAnnouncementError("INVALID_UUID");
  const hex = text.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function record(row: MongoRow): AnnouncementRecord {
  return { id: row.id as string, title: row.title as string, content: row.content as string,
    authorEmail: row.authorEmail as string, authorName: row.authorName as string | null,
    createdAt: row.createdAt as Date, updatedAt: row.updatedAt as Date };
}
export async function prepareMongoAnnouncementStore(options: MongoAnnouncementOptions): Promise<void> {
  try { await prepareMongoReadStore(options, ANNOUNCEMENT_MODELS); }
  catch (error) { throw safe(error, "ANNOUNCEMENT_PREPARE_FAILED"); }
}

/** Explicit shadow backend. API authorization, sanitization, file limits and
 * preflight remain outside this repository, including the existing stale PUT behavior.
 */
export class MongoAnnouncementRepository implements AnnouncementRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoAnnouncementOptions): Promise<MongoAnnouncementRepository> {
    try {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      const store = new MongoOperationStore(options, ANNOUNCEMENT_MODELS);
      const hello = await store.db.command({ hello: 1 });
      assertMongo(typeof hello.setName === "string" && typeof hello.logicalSessionTimeoutMinutes === "number", "REPLICA_SET_REQUIRED");
      await assertMongoReadStoreReady(store);
      return new MongoAnnouncementRepository(store);
    } catch (error) { throw safe(error, "ANNOUNCEMENT_OPEN_FAILED"); }
  }
  private async transaction<T>(work: (session: ClientSession, check: () => void) => Promise<T>): Promise<T> {
    try {
      const deadline = performance.now() + TIMEOUT_MS;
      const check = () => assertMongo(performance.now() < deadline, "ANNOUNCEMENT_TIMEOUT");
      const session = this.store.client.startSession();
      try {
        return await session.withTransaction(async () => {
          check(); const result = await work(session, check); check(); return result;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority", j: true }, readPreference: "primary", timeoutMS: TIMEOUT_MS });
      } finally { await session.endSession(); }
    } catch (error) { throw safe(error, "ANNOUNCEMENT_TRANSACTION_FAILED"); }
  }

  /** Complete rows are authenticated one at a time. The callback must not retain
   * binary data for metadata reads. Only attachment scans have the 64MiB allowance.
   */
  private async attachments(filter: Filter<MongoRuntimeDocument>, session: ClientSession, check: () => void, visit: (row: MongoRow) => void | Promise<void>): Promise<number> {
    const deadline = performance.now() + 15_000;
    let lastId: string | undefined, count = 0, bytes = 0;
    for (;;) {
      check(); assertMongo(performance.now() < deadline, "ATTACHMENT_SCAN_TIMEOUT");
      const cursor = this.store.collection("AnnouncementAttachment").find(lastId === undefined ? filter : { $and: [filter, { _id: { $gt: lastId } }] }, {
        session, singleBatch: true, batchSize: 100, collation: { locale: "simple" }, maxTimeMS: Math.max(1, Math.ceil(deadline - performance.now()))
      }).sort({ _id: 1 }).limit(100);
      let page = 0;
      try { for await (const document of cursor) {
        page++; count++; lastId = document._id; bytes += BSON.calculateObjectSize(document);
        assertMongo(count <= MONGO_SCAN_ROWS && bytes <= ATTACHMENT_SCAN_BYTES, "ATTACHMENT_SCAN_LIMIT");
        const row = decodeMongoRuntimeDocument("AnnouncementAttachment", document);
        check(); assertMongo(performance.now() < deadline, "ATTACHMENT_SCAN_TIMEOUT");
        await visit(row);
        check(); assertMongo(performance.now() < deadline, "ATTACHMENT_SCAN_TIMEOUT");
      } } finally { await cursor.close(); }
      check(); assertMongo(performance.now() < deadline, "ATTACHMENT_SCAN_TIMEOUT");
      // BSON-short pages may contain one large attachment; only empty proves EOF.
      if (!page) return count;
    }
  }
  private async fileMetadata(id: string, session: ClientSession, check: () => void): Promise<AnnouncementAttachmentRow[]> {
    const rows: Array<AnnouncementAttachmentRow & { createdAt: Date }> = [];
    await this.attachments({ announcementId: id }, session, check, row => {
      rows.push({ id: row.id as string, fileName: row.fileName as string, mimeType: row.mimeType as string, size: row.size as number, createdAt: row.createdAt as Date });
    });
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return rows.map(row => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, size: row.size }));
  }
  async list(): Promise<AnnouncementListRow[]> {
    return this.transaction(async (session, check) => {
      const rows = await this.store.scan("Announcement", { deletedAt: null }, session);
      rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (a.id as string).localeCompare(b.id as string));
      check();
      return rows.map(row => ({ id: row.id as string, title: row.title as string, authorEmail: row.authorEmail as string,
        authorName: row.authorName as string | null, createdAt: row.createdAt as Date, updatedAt: row.updatedAt as Date }));
    });
  }
  async getDetail(rawId: string): Promise<AnnouncementDetailRow | null> {
    const id = uuid(rawId);
    return this.transaction(async (session, check) => {
      const row = await this.store.one("Announcement", { _id: id, deletedAt: null }, session);
      if (!row) return null;
      return { ...record(row), attachments: await this.fileMetadata(id, session, check) };
    });
  }
  async getDetailPage(id: string): Promise<AnnouncementDetailPageRow | null> {
    const row = await this.getDetail(id);
    if (!row) return null;
    return { id: row.id, title: row.title, content: row.content, authorName: row.authorName, authorEmail: row.authorEmail, createdAt: row.createdAt,
      attachments: row.attachments.map(file => ({ id: file.id, fileName: file.fileName, size: file.size })) };
  }
  async getEditPage(id: string): Promise<AnnouncementEditPageRow | null> {
    const row = await this.getDetail(id);
    if (!row) return null;
    return { id: row.id, title: row.title, content: row.content, attachments: row.attachments.map(file => ({ id: file.id, fileName: file.fileName, size: file.size })) };
  }
  async getUpdateState(rawId: string): Promise<AnnouncementUpdateState | null> {
    const id = uuid(rawId);
    return this.transaction(async (session, check) => {
      const row = await this.store.one("Announcement", { _id: id }, session);
      if (!row) return null;
      const count = await this.attachments({ announcementId: id }, session, check, () => {});
      return { id: row.id as string, deletedAt: row.deletedAt as Date | null, _count: { attachments: count } };
    });
  }
  async getDeleteState(rawId: string): Promise<AnnouncementDeleteState | null> {
    const id = uuid(rawId);
    return this.transaction(async session => {
      const row = await this.store.one("Announcement", { _id: id }, session);
      return row ? { id: row.id as string, deletedAt: row.deletedAt as Date | null } : null;
    });
  }
  private async audit(model: string, before: MongoRow | null, after: MongoRow | null, session: ClientSession, check: () => void): Promise<void> {
    check(); const row = operationAuditRow(model, before, after); check();
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
    check();
  }
  private async createFiles(id: string, files: AnnouncementFileInput[], now: Date, session: ClientSession, check: () => void): Promise<void> {
    for (const file of files) {
      check();
      const row = completeMongoRow("AnnouncementAttachment", { id: randomUUID(), announcementId: id, fileName: file.fileName,
        mimeType: file.mimeType, size: file.size, data: file.data, createdAt: now });
      const document = encodeMongoRuntimeDocument("AnnouncementAttachment", row);
      check(); await this.store.collection("AnnouncementAttachment").insertOne(document, { session });
      await this.audit("AnnouncementAttachment", null, row, session, check);
    }
  }
  async create(input: Parameters<AnnouncementRepository["create"]>[0]): Promise<AnnouncementRecord> {
    return this.transaction(async (session, check) => {
      const now = new Date();
      const row = completeMongoRow("Announcement", { id: randomUUID(), title: input.title, content: input.content,
        authorEmail: input.authorEmail, authorName: input.authorName, createdAt: now, updatedAt: now });
      const document = encodeMongoRuntimeDocument("Announcement", row);
      check(); await this.store.collection("Announcement").insertOne(document, { session });
      await this.audit("Announcement", null, row, session, check);
      await this.createFiles(row.id as string, input.attachments, now, session, check);
      return record(row);
    });
  }
  async update(input: Parameters<AnnouncementRepository["update"]>[0]): Promise<AnnouncementRecord> {
    const id = uuid(input.id), removeIds = input.removeAttachmentIds.map(uuid);
    return this.transaction(async (session, check) => {
      const previous = await this.store.one("Announcement", { _id: id }, session);
      if (!previous) throw new MongoAnnouncementError("P2025");
      // Preflight is intentionally separate. Do not add deletedAt:null here:
      // stale PUT may edit a deleted parent but must preserve its deletion fields.
      const now = new Date();
      const next = completeMongoRow("Announcement", { ...previous, title: input.title, content: input.content, updatedAt: now });
      const encoded = encodeMongoRuntimeDocument("Announcement", next);
      check();
      const changed = await this.store.collection("Announcement").updateOne({ _id: id }, { $set: {
        title: encoded.title, titlePiiIndex: encoded.titlePiiIndex,
        content: encoded.content, contentPiiIndex: encoded.contentPiiIndex, updatedAt: encoded.updatedAt
      } }, { session });
      if (changed.matchedCount !== 1) throw new MongoAnnouncementError("P2025");
      await this.audit("Announcement", previous, next, session, check);
      if (removeIds.length) await this.attachments({ announcementId: id, _id: { $in: removeIds } }, session, check, async row => {
        const removed = await this.store.collection("AnnouncementAttachment").deleteOne({ _id: row.id as string, announcementId: id }, { session });
        assertMongo(removed.deletedCount === 1, "ANNOUNCEMENT_ATTACHMENT_DISAPPEARED");
        await this.audit("AnnouncementAttachment", row, null, session, check);
      });
      await this.createFiles(id, input.attachments, now, session, check);
      return record(next);
    });
  }
  async softDelete(rawId: string, deletedBy: string | null): Promise<void> {
    const id = uuid(rawId);
    await this.transaction(async (session, check) => {
      const previous = await this.store.one("Announcement", { _id: id }, session);
      if (!previous) throw new MongoAnnouncementError("P2025");
      const now = new Date();
      const next = completeMongoRow("Announcement", { ...previous, deletedAt: now, deletedBy, updatedAt: now });
      const encoded = encodeMongoRuntimeDocument("Announcement", next);
      check();
      const changed = await this.store.collection("Announcement").updateOne({ _id: id }, { $set: {
        deletedAt: encoded.deletedAt, deletedBy: encoded.deletedBy, deletedByPiiIndex: encoded.deletedByPiiIndex, updatedAt: encoded.updatedAt
      } }, { session });
      if (changed.matchedCount !== 1) throw new MongoAnnouncementError("P2025");
      await this.audit("Announcement", previous, next, session, check);
    });
  }
  async download(rawId: string, rawAttachmentId: string): Promise<{ fileName: string; mimeType: string; data: Uint8Array } | null> {
    const id = uuid(rawId), attachmentId = uuid(rawAttachmentId);
    return this.transaction(async (session, check) => {
      const parent = await this.store.one("Announcement", { _id: id, deletedAt: null }, session);
      if (!parent) return null;
      let file: { fileName: string; mimeType: string; data: Uint8Array } | null = null;
      await this.attachments({ _id: attachmentId, announcementId: id }, session, check, row => {
        file = { fileName: row.fileName as string, mimeType: row.mimeType as string, data: row.data as Uint8Array };
      });
      return file;
    });
  }
}
