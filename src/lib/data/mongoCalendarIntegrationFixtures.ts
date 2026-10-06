/** Calendar native 통합 테스트 두 개에서만 사용하는 합성 fixture. 실행은 전용 opt-in 필수. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { BSON, Long, MongoClient, type CommandStartedEvent } from "mongodb";
import { activityContext } from "../activity/context";
import type { CalendarEventLink } from "../googleCalendar/calendarEventLinkRepository";
import { MongoCalendarOperationLock, prepareMongoCalendarLeaseStore } from "./mongoCalendarOperationLock";
import { CALENDAR_PERSISTENCE_MODELS, MongoCalendarPersistence, prepareMongoCalendarPersistenceStore } from "./mongoCalendarPersistence";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationError, MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const CALENDAR_TEST_URI = "mongodb://127.0.0.1:27849/?replicaSet=calendarboundary20260930";
export const calendarOptIn = process.env.MONGODB_CALENDAR_TEST_URI;
export const privateCalendar = "synthetic-calendar-private@example.invalid";
export const privateEvent = "synthetic-event-private-sentinel";
export const privateActor = "synthetic-calendar-actor@example.invalid";
export const keyNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
export function syntheticKeys() {
  return { PII_ENCRYPTION_KEYS: JSON.stringify({ calendar: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "calendar", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
}
export function link(operationId = "synthetic-calendar-a", eventDate = "2099-12-01"): CalendarEventLink {
  return { operationId, eventDate, calendarId: privateCalendar, eventId: privateEvent };
}
export function attributed<T>(work: () => Promise<T>, requestId: string = randomUUID()) {
  return activityContext.run({ requestId, actorEmail: privateActor, actorName: "가상 Calendar 작성자", actorType: "user",
    route: "/synthetic/calendar-storage", method: "POST" }, work);
}
export function safeError(error: unknown): boolean {
  assert.ok(error instanceof MongoOperationError);
  assert.match(error.code, /^[A-Z][A-Z0-9_]+$/);
  assert.equal(error.message, "Mongo operation failed: " + error.code);
  assert.equal(error.cause, undefined);
  for (const secret of [privateCalendar, privateEvent, privateActor, "가상 Calendar 작성자"]) {
    assert.ok(!String(error.stack).includes(secret));
  }
  return true;
}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export async function bounded<T>(promise: Promise<T>, ms = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synthetic Calendar barrier timeout")), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export async function arrived(held: ReturnType<typeof barrier>, pending: Promise<unknown>) {
  await bounded(Promise.race([held.promise, pending.then(() => { throw new Error("Calendar completed before barrier"); })]));
}

export async function calendarHarness(work: (harness: CalendarHarness) => Promise<void>) {
  // 문자열 전체 일치: 다른 port/replica/자격증명/옵션 및 운영 URI fallback을 허용하지 않는다.
  assert.equal(calendarOptIn, CALENDAR_TEST_URI, "Calendar 전용 endpoint의 정확한 opt-in이 필요합니다");
  const clients: MongoClient[] = [];
  const client = new MongoClient(CALENDAR_TEST_URI, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  clients.push(client);
  const databaseName = "hub_om_shadow_calendar_" + randomBytes(12).toString("hex");
  const keys = syntheticKeys();
  const saved = new Map(keyNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, keys);
  let owned = false;
  const fixture = async () => {
    const options = { client, databaseName, namespace: "shadow_calendar_" + randomBytes(10).toString("hex"), allowShadowWrites: true as const };
    await prepareMongoCalendarLeaseStore(options);
    await prepareMongoCalendarPersistenceStore(options);
    const lock = await MongoCalendarOperationLock.open(options);
    const repo = await MongoCalendarPersistence.open(options, lock);
    const store = new MongoOperationStore(options, CALENDAR_PERSISTENCE_MODELS);
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, values);
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row));
      return row;
    };
    const snapshot = async () => {
      const result: Record<string, Buffer[]> = {};
      for (const model of CALENDAR_PERSISTENCE_MODELS) {
        result[model] = (await store.collection(model).find({}).sort({ _id: 1 }).toArray()).map(row => Buffer.from(BSON.serialize(row)));
      }
      return result;
    };
    const metadata = async () => {
      const rows = await store.db.listCollections({ name: { $regex: "^" + options.namespace + "_" } }, { nameOnly: false }).toArray();
      return Promise.all(rows.sort((a, b) => a.name.localeCompare(b.name)).map(async row => ({ name: row.name, options: row.options,
        indexes: (await store.db.collection(row.name).listIndexes().toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))) })));
    };
    const otherLock = async () => {
      const second = new MongoClient(CALENDAR_TEST_URI, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
      clients.push(second); await second.connect();
      return MongoCalendarOperationLock.open({ ...options, client: second });
    };
    // 명시 fault: 정상 lease 만료/takeover로 부르지 않는다. 진짜 native write이며 scope는 소유 fixture뿐이다.
    const forceOwner = async (operationId: string) => {
      const owner = randomUUID();
      const row = await lock.leases.findOneAndUpdate({ _id: operationId }, [{ $set: { owner: { $literal: owner },
        generation: { $add: ["$generation", Long.ONE] }, nonce: { $literal: randomUUID() },
        leaseUntil: { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: 60_000 } } } }],
      { returnDocument: "after", writeConcern: { w: "majority", j: true }, timeoutMS: 5_000 });
      assert.ok(row); assert.equal(row.owner, owner); return row;
    };
    return { options, lock, repo, store, seed, snapshot, metadata, otherLock, forceOwner };
  };
  try {
    await client.connect();
    assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0, "기존 DB의 소유권을 취하지 않는다");
    owned = true;
    const hello = await client.db(databaseName).command({ hello: 1 });
    assert.equal(hello.setName, "calendarboundary20260930");
    assert.equal(typeof hello.logicalSessionTimeoutMinutes, "number");
    await work({ client, databaseName, keys, fixture });
  } finally {
    try { if (owned) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await Promise.all(clients.map(value => value.close())); }
      finally { for (const name of keyNames) { const value = saved.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    }
  }
}
export type CalendarHarness = { client: MongoClient; databaseName: string; keys: ReturnType<typeof syntheticKeys>; fixture: () => Promise<CalendarFixture> };
export type CalendarFixture = {
  options: { client: MongoClient; databaseName: string; namespace: string; allowShadowWrites: true };
  lock: MongoCalendarOperationLock; repo: MongoCalendarPersistence; store: MongoOperationStore;
  seed: (model: string, values: MongoRow) => Promise<MongoRow>;
  snapshot: () => Promise<Record<string, Buffer[]>>;
  metadata: () => Promise<Array<{ name: string; options: unknown; indexes: unknown[] }>>;
  otherLock: () => Promise<MongoCalendarOperationLock>;
  forceOwner: (operationId: string) => Promise<NonNullable<Awaited<ReturnType<MongoCalendarOperationLock["leases"]["findOne"]>>>>;
};
export function wire(client: MongoClient, databaseName: string) {
  const commands: CommandStartedEvent[] = [];
  const listener = (event: CommandStartedEvent) => { if (event.databaseName === databaseName || event.commandName === "commitTransaction") commands.push(event); };
  client.on("commandStarted", listener);
  return { commands, stop: () => client.off("commandStarted", listener) };
}
