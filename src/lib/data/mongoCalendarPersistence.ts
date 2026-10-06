import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { CalendarPersistence } from "../googleCalendar/calendarPersistence";
import type { CalendarEventLink } from "../googleCalendar/calendarEventLinkRepository";
import { assertPrivacyConfiguration } from "../privacy/crypto";
import { MongoCalendarOperationLock, type MongoCalendarOptions } from "./mongoCalendarOperationLock";
import { operationAuditRow } from "./mongoOperationAudit";
import { assertMongo, completeMongoRow, MongoOperationError, MongoOperationStore, operationMongoIndexes, operationMongoValidator, stableMongoValue, type MongoRow } from "./mongoOperationStore";
import { assertMongoReadStoreReady, prepareMongoReadStore } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const CALENDAR_PERSISTENCE_MODELS = ["CalendarEventLink", "OperationSession", "ActivityChange"] as const;
const toDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  assertMongo(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, "CALENDAR_INVALID_DATE");
  return date;
};
const toLink = (row: MongoRow): CalendarEventLink => ({ operationId: row.operationId as string, calendarId: row.calendarId as string, eventId: row.eventId as string, eventDate: (row.eventDate as Date).toISOString().slice(0, 10) });
const compareText = (a: unknown, b: unknown) => Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("CALENDAR_PERSISTENCE_FAILED"); }
}
async function assertMappingIndexes(store: MongoOperationStore): Promise<void> {
  const expected = operationMongoIndexes("CalendarEventLink").filter(index => index.unique);
  const collection = store.collection("CalendarEventLink");
  const info = await store.db.listCollections({ name: collection.collectionName }, { nameOnly: false }).next();
  assertMongo(info && !info.options?.capped, "CALENDAR_MAPPING_NOT_READY");
  for (const index of await collection.listIndexes().toArray()) {
    const known = expected.find(item => item.name === index.name);
    assertMongo(index.expireAfterSeconds === undefined && (!index.unique || index.name === "_id_" || known
      && stableMongoValue(known.key) === stableMongoValue(index.key)
      && stableMongoValue(known.partialFilterExpression) === stableMongoValue(index.partialFilterExpression)
      && !index.sparse && !index.hidden && (!index.collation || index.collation.locale === "simple")), "CALENDAR_MAPPING_INDEX_MISMATCH");
  }
}
/** Existing shared collections must already match; never repair their metadata here. */
export async function prepareMongoCalendarPersistenceStore(options: MongoCalendarOptions): Promise<void> {
  return safe(async () => {
    assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
    assertPrivacyConfiguration();
    const store = new MongoOperationStore(options, CALENDAR_PERSISTENCE_MODELS);
    const missing: string[] = [];
    for (const model of CALENDAR_PERSISTENCE_MODELS) {
      const existing = await store.db.listCollections({ name: store.collection(model).collectionName }, { nameOnly: true }).next();
      if (existing) {
        await assertMongoReadStoreReady(new MongoOperationStore(options, [model]));
        if (model === "CalendarEventLink") await assertMappingIndexes(store);
        // A current validator does not retroactively validate historical rows.
        // Preserve the shared prepare helper's policy gate without collMod.
        assertMongo(!await store.collection(model).findOne({ $nor: [operationMongoValidator(model)] },
          { projection: { _id: 1 }, timeoutMS: 60_000 }), "EXISTING_DOCUMENTS_POLICY_MISMATCH");
      } else missing.push(model);
    }
    if (missing.length) await prepareMongoReadStore(options, missing);
    await assertMappingIndexes(store);
  });
}
export class MongoCalendarPersistence implements CalendarPersistence {
  private readonly store: MongoOperationStore;
  private readonly lock: MongoCalendarOperationLock;
  private constructor(store: MongoOperationStore, lock: MongoCalendarOperationLock) { this.store = store; this.lock = lock; }
  static async open(options: MongoCalendarOptions, lock: MongoCalendarOperationLock): Promise<MongoCalendarPersistence> {
    return safe(async () => {
      assertMongo(options.allowShadowWrites === true, "SHADOW_WRITE_GATE");
      assertPrivacyConfiguration();
      assertMongo(lock.matches(options), "CALENDAR_SCOPE_MISMATCH");
      const store = new MongoOperationStore(options, CALENDAR_PERSISTENCE_MODELS);
      await assertMongoReadStoreReady(store);
      await assertMappingIndexes(store);
      return new MongoCalendarPersistence(store, lock);
    });
  }
  listCalendarEventLinks(operationId: string): Promise<CalendarEventLink[]> {
    return safe(async () => (await this.store.scan("CalendarEventLink", { operationId }))
      .sort((a, b) => (a.eventDate as Date).getTime() - (b.eventDate as Date).getTime()).map(toLink));
  }
  listAllCalendarEventLinks(): Promise<CalendarEventLink[]> {
    return safe(async () => (await this.store.scan("CalendarEventLink"))
      .sort((a, b) => compareText(a.operationId, b.operationId) || (a.eventDate as Date).getTime() - (b.eventDate as Date).getTime()).map(toLink));
  }
  findCalendarEventLinksByCalendar(calendarId: string): Promise<Map<string, CalendarEventLink>> {
    return safe(async () => new Map((await this.store.findPrivateEqual("CalendarEventLink", "calendarId", calendarId)).map(row => [row.eventId as string, toLink(row)])));
  }
  findOperationUpdatedAt(operationIds: string[]): Promise<Map<string, Date>> {
    return safe(async () => {
      if (!operationIds.length) return new Map();
      const rows = await this.store.scan("OperationSession", { operationId: { $in: [...new Set(operationIds)] } });
      return new Map(rows.map(row => [row.operationId as string, row.updatedAt as Date]));
    });
  }
  private async audit(before: MongoRow | null, after: MongoRow | null, session: ClientSession): Promise<void> {
    const row = operationAuditRow("CalendarEventLink", before, after);
    if (row) await this.store.collection("ActivityChange").insertOne(encodeMongoRuntimeDocument("ActivityChange", row), { session });
  }
  saveCalendarEventLink(link: CalendarEventLink): Promise<void> {
    return safe(() => this.lock.mapping(link.operationId, async session => {
      const eventDate = toDate(link.eventDate);
      const before = await this.store.one("CalendarEventLink", { operationId: link.operationId, eventDate }, session);
      const now = new Date();
      const after = completeMongoRow("CalendarEventLink", { id: before?.id ?? randomUUID(), createdAt: before?.createdAt ?? now,
        updatedAt: now, operationId: link.operationId, calendarId: link.calendarId, eventId: link.eventId, eventDate });
      const encoded = encodeMongoRuntimeDocument("CalendarEventLink", after);
      if (before) {
        const result = await this.store.collection("CalendarEventLink").replaceOne({ _id: before.id as string }, encoded, { session });
        assertMongo(result.matchedCount === 1, "CALENDAR_MAPPING_CHANGED");
      } else await this.store.collection("CalendarEventLink").insertOne(encoded, { session });
      await this.audit(before, after, session);
    }));
  }
  private remove(operationId: string, eventDate?: string, expected?: CalendarEventLink): Promise<void> {
    return safe(() => this.lock.mapping(operationId, async session => {
      const rows = await this.store.scan("CalendarEventLink", { operationId, ...(eventDate !== undefined ? { eventDate: toDate(eventDate) } : {}) }, session);
      for (const row of rows) {
        // Authenticate/decrypt before comparing original values, including HMAC.
        if (expected && (row.calendarId !== expected.calendarId || row.eventId !== expected.eventId)) continue;
        const result = await this.store.collection("CalendarEventLink").deleteOne({ _id: row.id as string }, { session });
        assertMongo(result.deletedCount === 1, "CALENDAR_MAPPING_CHANGED");
        await this.audit(row, null, session);
      }
    }));
  }
  deleteCalendarEventLink(operationId: string, eventDate: string): Promise<void> { return this.remove(operationId, eventDate); }
  deleteCalendarEventLinks(operationId: string): Promise<void> { return this.remove(operationId); }
  deleteMatchingCalendarEventLink(link: CalendarEventLink): Promise<void> { return this.remove(link.operationId, link.eventDate, link); }
  moveCalendarEventLinkDate(link: CalendarEventLink, toDateString: string): Promise<void> {
    return safe(() => this.lock.mapping(link.operationId, async session => {
      const before = await this.store.one("CalendarEventLink", { operationId: link.operationId, eventDate: toDate(link.eventDate) }, session);
      assertMongo(before && before.calendarId === link.calendarId && before.eventId === link.eventId, "CALENDAR_MAPPING_CHANGED");
      const after = completeMongoRow("CalendarEventLink", { ...before, eventDate: toDate(toDateString), updatedAt: new Date() });
      const result = await this.store.collection("CalendarEventLink").replaceOne({ _id: before.id as string }, encodeMongoRuntimeDocument("CalendarEventLink", after), { session });
      assertMongo(result.matchedCount === 1, "CALENDAR_MAPPING_CHANGED");
      await this.audit(before, after, session);
    }));
  }
}
