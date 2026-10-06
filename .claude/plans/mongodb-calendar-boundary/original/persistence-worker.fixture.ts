/** Separate process: frozen PG, current PG, or actual Mongo. Expected audit literals never use product audit builders. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { MongoClient } from "mongodb";
import type { PrismaClient } from "@prisma/client";
import type { CalendarPersistence, CalendarLockPort } from "../../../../src/lib/googleCalendar/calendarPersistence";
import type { CalendarEventLink } from "../../../../src/lib/googleCalendar/calendarEventLinkRepository";
import type { ActivityContext } from "../../../../src/lib/activity/context";
import type { AsyncLocalStorage } from "node:async_hooks";
import { configure, ownPg, MONGO_URI, send } from "./oracle-environment.fixture.ts";
import { frozen } from "./frozen-loader.fixture.ts";

type Row = Record<string, unknown>;
const ROOT = new URL("../../../../", import.meta.url);
const current = <T>(file: string) => import(new URL(file, ROOT).href) as Promise<T>;
const actor: ActivityContext = { requestId: "00000000-0000-4000-8000-000000009999", actorEmail: "private-oracle@example.invalid", actorName: "PRIVATE_ORACLE_ACTOR", actorType: "user", route: "/synthetic/calendar-oracle", method: "POST" };
const link: CalendarEventLink = { operationId: "synthetic-A", eventDate: "2030-01-02", calendarId: "PRIVATE_CAL_A", eventId: "PRIVATE_EVENT_A" };
const redacted = { redacted: true };
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};
const creation = (value: CalendarEventLink) => ({ operation_id: { before: null, after: value.operationId }, event_date: { before: null, after: value.eventDate }, calendar_id: redacted, event_id: redacted });
const deletion = (value: CalendarEventLink) => ({ operation_id: { before: value.operationId, after: null }, event_date: { before: value.eventDate, after: null }, calendar_id: redacted, event_id: redacted });

async function run() {
  configure();
  const backend = process.argv[2]; assert.ok(["original", "current", "mongo"].includes(backend));
  const ledger: Array<{ name: string; value: unknown }> = [];
  let pgOwned: Awaited<ReturnType<typeof ownPg>> | undefined, prisma: PrismaClient | undefined, client: MongoClient | undefined;
  let mongoOwned = false, databaseName = "";
  let api: CalendarPersistence, lock: CalendarLockPort | undefined;
  let context: AsyncLocalStorage<ActivityContext>;
  let raw: () => Promise<{ mappings: Row[]; audits: Row[] }>;
  let logical: () => Promise<{ mappings: Row[]; audits: Row[] }>;
  let seedTimestamps: () => Promise<void>;
  let installAuditFault: () => Promise<() => Promise<void>>;
  try {
    if (backend !== "mongo") {
      pgOwned = await ownPg();
      const load = backend === "original" ? frozen : current;
      const db = await load<{ getPrismaClient(): PrismaClient }>("src/lib/data/prisma.ts"); prisma = db.getPrismaClient();
      context = (await load<{ activityContext: AsyncLocalStorage<ActivityContext> }>("src/lib/activity/context.ts")).activityContext;
      const fields = await load<{ decryptField(model: string, field: string, value: unknown): unknown }>("src/lib/privacy/fields.ts");
      api = backend === "original" ? {
        ...await frozen<Omit<CalendarPersistence, "findOperationUpdatedAt">>("src/lib/googleCalendar/calendarEventLinkRepository.ts"),
        ...await frozen<Pick<CalendarPersistence, "findOperationUpdatedAt">>("src/lib/googleCalendar/operationSessionTimestamps.ts")
      } : {
        ...await current<Omit<CalendarPersistence, "findOperationUpdatedAt">>("src/lib/googleCalendar/calendarEventLinkRepository.ts"),
        ...await current<Pick<CalendarPersistence, "findOperationUpdatedAt">>("src/lib/googleCalendar/operationSessionTimestamps.ts")
      };
      const sql = pgOwned.sql;
      raw = async () => ({ mappings: (await sql.query("SELECT * FROM calendar_event_links ORDER BY id")).rows, audits: (await sql.query("SELECT * FROM activity_changes ORDER BY id")).rows });
      logical = async () => {
        const data = await raw();
        return { mappings: data.mappings.map(row => ({ id: row.id, operationId: row.operation_id, eventDate: new Date(row.event_date as string | Date).toISOString().slice(0, 10),
          calendarId: fields.decryptField("CalendarEventLink", "calendarId", row.calendar_id), eventId: fields.decryptField("CalendarEventLink", "eventId", row.event_id), createdAt: row.created_at, updatedAt: row.updated_at })),
        audits: data.audits.map(row => ({ id: row.id, targetId: row.target_id, targetType: row.target_type, action: row.action, requestId: row.request_id,
          actorEmail: fields.decryptField("ActivityChange", "actorEmail", row.actor_email), actorName: fields.decryptField("ActivityChange", "actorName", row.actor_name),
          actorType: row.actor_type, route: row.route, method: row.method, occurredAt: row.occurred_at, changes: fields.decryptField("ActivityChange", "changes", row.changes) })) };
      };
      seedTimestamps = async () => {
        const company = await prisma!.company.create({ data: { name: "Synthetic timestamp company", normalizedName: "synthetic timestamp company" } });
        const course = await prisma!.course.create({ data: { companyId: company.id, courseId: "timestamps", name: "Synthetic timestamp course" } });
        for (const [i, operationId] of ["time-active", "time-deleted", "time-equal"].entries()) await prisma!.operationSession.create({ data: {
          operationId, courseRecordId: course.id, startDate: new Date("2030-01-01T00:00:00Z"), endDate: new Date("2030-01-02T00:00:00Z"), educationDates: [],
          updatedAt: new Date(i === 1 ? "2030-02-02T03:04:05Z" : "2030-02-01T03:04:05Z"), deletedAt: i === 1 ? new Date("2030-01-03T00:00:00Z") : null } });
      };
      installAuditFault = async () => {
        await sql.query("CREATE FUNCTION oracle_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$; CREATE TRIGGER oracle_reject BEFORE INSERT ON activity_changes FOR EACH ROW EXECUTE FUNCTION oracle_reject_audit()");
        return async () => { await sql.query("DROP TRIGGER oracle_reject ON activity_changes; DROP FUNCTION oracle_reject_audit()"); };
      };
    } else {
      client = new MongoClient(MONGO_URI, { directConnection: true, serverSelectionTimeoutMS: 5000 }); await client.connect();
      const hello = await client.db("admin").command({ hello: 1 }); assert.equal(hello.setName, "calendarboundary20260930"); assert.equal(hello.isWritablePrimary, true);
      databaseName = `hub_om_shadow_calendar_oracle_${randomBytes(10).toString("hex")}`;
      assert.equal((await client.db(databaseName).listCollections().toArray()).length, 0); mongoOwned = true;
      const options = { client, databaseName, namespace: "shadow_calendar_oracle", allowShadowWrites: true as const };
      const lease = await current<{ prepareMongoCalendarLeaseStore(config: typeof options): Promise<void>; MongoCalendarOperationLock: { open(config: typeof options): Promise<CalendarLockPort> } }>("src/lib/data/mongoCalendarOperationLock.ts");
      const persistence = await current<{ prepareMongoCalendarPersistenceStore(config: typeof options): Promise<void>; MongoCalendarPersistence: { open(config: typeof options, lock: CalendarLockPort): Promise<CalendarPersistence> } }>("src/lib/data/mongoCalendarPersistence.ts");
      await lease.prepareMongoCalendarLeaseStore(options); lock = await lease.MongoCalendarOperationLock.open(options);
      await persistence.prepareMongoCalendarPersistenceStore(options); api = await persistence.MongoCalendarPersistence.open(options, lock);
      context = (await current<{ activityContext: AsyncLocalStorage<ActivityContext> }>("src/lib/activity/context.ts")).activityContext;
      const { MongoOperationStore, completeMongoRow } = await current<typeof import("../../../../src/lib/data/mongoOperationStore")>("src/lib/data/mongoOperationStore.ts");
      const { encodeMongoRuntimeDocument, decodeMongoRuntimeDocument } = await current<typeof import("../../../../src/lib/data/mongoRuntimeCodec")>("src/lib/data/mongoRuntimeCodec.ts");
      const { prepareMongoReadStore } = await current<typeof import("../../../../src/lib/data/mongoReadStore")>("src/lib/data/mongoReadStore.ts");
      await prepareMongoReadStore(options, ["Company", "Course", "OperationSession"]);
      const store = new MongoOperationStore(options, ["CalendarEventLink", "ActivityChange", "Company", "Course", "OperationSession"]);
      raw = async () => ({ mappings: await store.collection("CalendarEventLink").find({}).sort({ _id: 1 }).toArray(), audits: await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray() });
      logical = async () => { const data = await raw(); return { mappings: data.mappings.map(row => { const d = decodeMongoRuntimeDocument("CalendarEventLink", row); return {
        id: d.id, operationId: d.operationId, eventDate: (d.eventDate as Date).toISOString().slice(0, 10), calendarId: d.calendarId, eventId: d.eventId, createdAt: d.createdAt, updatedAt: d.updatedAt }; }),
        audits: data.audits.map(row => { const d = decodeMongoRuntimeDocument("ActivityChange", row); return Object.fromEntries(["id", "targetId", "targetType", "action", "requestId", "actorEmail", "actorName", "actorType", "route", "method", "occurredAt", "changes"].map(key => [key, d[key]])); }) }; };
      seedTimestamps = async () => {
        const companyId = randomUUID(), courseId = randomUUID(), now = new Date("2030-01-01T00:00:00Z");
        const seed = async (model: string, row: Row) => { await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, completeMongoRow(model, row))); };
        await seed("Company", { id: companyId, name: "Synthetic timestamp company", normalizedName: "synthetic timestamp company", createdAt: now, updatedAt: now });
        await seed("Course", { id: courseId, companyId, courseId: "timestamps", name: "Synthetic timestamp course", operationType: "NEEDS_REVIEW", processSeq: 1, createdAt: now, updatedAt: now });
        for (const [i, operationId] of ["time-active", "time-deleted", "time-equal"].entries()) await seed("OperationSession", {
          id: randomUUID(), operationId, courseRecordId: courseId, startDate: now, endDate: new Date("2030-01-02T00:00:00Z"), educationDates: [],
          operationStatus: "ASSIGNMENT_NEEDED", archiveStatus: "NOT_READY", educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN", hasSatisfactionSurvey: "NEEDS_REVIEW", hasResultReport: "NEEDS_REVIEW",
          createdAt: now, updatedAt: new Date(i === 1 ? "2030-02-02T03:04:05Z" : "2030-02-01T03:04:05Z"), deletedAt: i === 1 ? new Date("2030-01-03T00:00:00Z") : null });
      };
      installAuditFault = async () => {
        const name = store.collection("ActivityChange").collectionName;
        const info = await store.db.listCollections({ name }, { nameOnly: false }).next(); assert.ok(info);
        await store.db.command({ collMod: name, validator: { requestId: "impossible-synthetic-audit-request" }, validationLevel: "strict", validationAction: "error" });
        return async () => { await store.db.command({ collMod: name, validator: info.options?.validator ?? {}, validationLevel: "strict", validationAction: "error" }); };
      };
    }
    const mutate = (operationId: string, work: () => Promise<void>, attributed = true) => {
      const run = () => lock ? lock.withLock(operationId, work) : work();
      return attributed ? context.run(actor, run) : run();
    };
    const auditExpected = (row: Row, action: string, changes: Row) => {
      assert.equal(row.targetType, "calendar_event_links"); assert.equal(row.action, action); assert.deepEqual(row.changes, changes);
      for (const key of ["requestId", "actorEmail", "actorName", "actorType", "route", "method"] as const) assert.equal(row[key], actor[key]);
    };
    const step = async (name: string, work: () => Promise<void>, expectedAudits: Array<{ action: string; changes: Row }>) => {
      const rawBefore = await raw(), before = await logical();
      // PG audit defaults use server clock_timestamp(), rounded to timestamptz(3).
      // Observe that same clock/precision; never compare it to client Date.now().
      const pgAuditClock = async () => {
        assert.ok(pgOwned);
        const value: unknown = (await pgOwned.sql.query("SELECT clock_timestamp()::timestamptz(3) AS observed_at")).rows[0].observed_at;
        assert.ok(value instanceof Date && Number.isFinite(value.getTime()), `${backend}/${name}: invalid PG clock observation`);
        return value.getTime();
      };
      const pgAuditStart = pgOwned ? await pgAuditClock() : undefined;
      const start = Date.now();
      assert.equal(await work(), undefined, `${name}: void result`);
      const end = Date.now();
      const pgAuditEnd = pgOwned ? await pgAuditClock() : undefined;
      const auditStart = pgAuditStart ?? start, auditEnd = pgAuditEnd ?? end;
      assert.ok(auditStart <= auditEnd, `${backend}/${name}: audit clock moved backwards: ${auditStart} -> ${auditEnd}`);
      const after = await logical();
      const rawAfter = await raw();
      for (const previousAudit of rawBefore.audits) assert.deepEqual(rawAfter.audits.find(row => (row.id ?? row._id) === (previousAudit.id ?? previousAudit._id)), previousAudit, `${name}: prior audit mutated`);
      const ids = new Set(before.audits.map(row => row.id)); const added = after.audits.filter(row => !ids.has(row.id));
      assert.equal(added.length, expectedAudits.length, name);
      const available = [...expectedAudits];
      for (const row of added) {
        const index = available.findIndex(item => item.action === row.action && canonical(item.changes) === canonical(row.changes));
        assert.ok(index >= 0, name); const item = available.splice(index, 1)[0]; auditExpected(row, item.action, item.changes);
        assert.ok([...before.mappings, ...after.mappings].some(link => link.id === row.targetId));
        assert.ok(row.occurredAt instanceof Date && row.occurredAt.getTime() >= auditStart && row.occurredAt.getTime() <= auditEnd,
          `${backend}/${name}: occurredAt=${row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt)} outside ${pgOwned ? "PG clock_timestamp(3)" : "client Date.now()"} bounds [${new Date(auditStart).toISOString()}, ${new Date(auditEnd).toISOString()}]`);
      }
      for (const row of after.mappings) {
        assert.match(String(row.id), /^[0-9a-f-]{36}$/i);
        const old = before.mappings.find(item => item.id === row.id);
        if (old) assert.deepEqual(row.createdAt, old.createdAt);
        else assert.ok(row.createdAt instanceof Date && row.createdAt.getTime() >= start && row.createdAt.getTime() <= end);
        assert.ok(row.updatedAt instanceof Date);
        if (!old || (old.updatedAt as Date).getTime() !== row.updatedAt.getTime()) assert.ok(row.updatedAt.getTime() >= start && row.updatedAt.getTime() <= end);
      }
      const stored = JSON.stringify(await raw());
      for (const privateText of ["PRIVATE_CAL", "PRIVATE_EVENT", actor.actorEmail!, actor.actorName!]) assert.equal(stored.includes(privateText), false, name);
      // Entire approved mapping tuple and every audit change survive comparison.
      ledger.push({ name, value: { links: (await api.listAllCalendarEventLinks()), audits: added.map(row => ({ action: row.action, changes: row.changes, actorEmail: row.actorEmail, actorName: row.actorName, requestId: row.requestId, target: (() => { const target = [...after.mappings, ...before.mappings].find(item => item.id === row.targetId)!; return { operationId: target.operationId, eventDate: target.eventDate }; })(), targetType: row.targetType, actorType: row.actorType, route: row.route, method: row.method })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) } });
    };
    await step("BP01 insert", () => mutate(link.operationId, () => api.saveCalendarEventLink(link)), [{ action: "create", changes: creation(link) }]);
    const initial = (await logical()).mappings[0];
    await step("BP02 same-value upsert", () => mutate(link.operationId, () => api.saveCalendarEventLink(link)), []);
    assert.equal((await logical()).mappings[0].id, initial.id);
    const changed = { ...link, calendarId: "PRIVATE_CAL_B", eventId: "PRIVATE_EVENT_B" };
    await step("BP03 replace private IDs", () => mutate(link.operationId, () => api.saveCalendarEventLink(changed)), [{ action: "update", changes: { calendar_id: redacted, event_id: redacted } }]);
    assert.equal((await logical()).mappings[0].id, initial.id, "upsert preserves mapping UUID");
    assert.equal((await api.findCalendarEventLinksByCalendar(link.calendarId)).size, 0);
    assert.deepEqual(await api.findCalendarEventLinksByCalendar(changed.calendarId), new Map([[changed.eventId, changed]]));
    await step("BP09 stale conditional delete preserves replacement", () => mutate(link.operationId, () => api.deleteMatchingCalendarEventLink(link)), []);
    await step("BP06 move", () => mutate(link.operationId, () => api.moveCalendarEventLinkDate(changed, "2030-01-03")), [{ action: "update", changes: { event_date: { before: "2030-01-02", after: "2030-01-03" } } }]);
    assert.equal((await logical()).mappings[0].id, initial.id, "move preserves mapping UUID");
    const moved = { ...changed, eventDate: "2030-01-03" };
    await step("BP13 same date move", () => mutate(moved.operationId, () => api.moveCalendarEventLinkDate(moved, moved.eventDate)), []);
    for (const field of ["operationId", "eventDate", "calendarId", "eventId"] as const) {
      const stale = { ...moved, [field]: field === "eventDate" ? "2031-01-01" : "synthetic-mismatch" };
      const before = await raw(); await assert.rejects(() => mutate(stale.operationId, () => api.moveCalendarEventLinkDate(stale, "2030-01-04")), error => { if (backend !== "mongo") assert.equal((error as Error).message, "이동할 캘린더 매핑이 변경되었습니다."); return true; });
      assert.deepEqual(await raw(), before, `BP07 ${field}`);
    }
    const second = { ...moved, eventDate: "2030-01-01" };
    await step("BP01 second date", () => mutate(second.operationId, () => api.saveCalendarEventLink(second)), [{ action: "create", changes: creation(second) }]);
    assert.deepEqual(await api.listCalendarEventLinks(link.operationId), [second, moved]);
    const beforeConflict = await raw(); await assert.rejects(() => mutate(moved.operationId, () => api.moveCalendarEventLinkDate(moved, second.eventDate))); assert.deepEqual(await raw(), beforeConflict, "BP08 unique conflict");
    const duplicate = { ...second, operationId: "synthetic-B" };
    await step("BP10 nonunique reverse candidates", () => mutate(duplicate.operationId, () => api.saveCalendarEventLink(duplicate)), [{ action: "create", changes: creation(duplicate) }]);
    const reverse = await api.findCalendarEventLinksByCalendar(changed.calendarId); assert.equal(reverse.size, 1);
    assert.ok([second, moved, duplicate].some(row => isDeepStrictEqual(row, reverse.get(changed.eventId))),
      "BP10: selected reverse mapping must equal one complete candidate, irrespective of object property insertion order");
    const restoreAudit = await installAuditFault();
    try { const before = await raw(); await assert.rejects(() => mutate("synthetic-fault", () => api.saveCalendarEventLink({ ...link, operationId: "synthetic-fault" }))); assert.deepEqual(await raw(), before, "BP12 audit failure rollback"); }
    finally { await restoreAudit(); }
    await step("BP04 delete one", () => mutate(second.operationId, () => api.deleteCalendarEventLink(second.operationId, second.eventDate)), [{ action: "delete", changes: deletion(second) }]);
    await step("BP04 missing delete", () => mutate(second.operationId, () => api.deleteCalendarEventLink(second.operationId, second.eventDate)), []);
    const third = { ...moved, eventDate: "2030-01-04" };
    await step("BP05 bulk fixture", () => mutate(third.operationId, () => api.saveCalendarEventLink(third)), [{ action: "create", changes: creation(third) }]);
    await step("BP05 delete all", () => mutate(moved.operationId, () => api.deleteCalendarEventLinks(moved.operationId)), [{ action: "delete", changes: deletion(moved) }, { action: "delete", changes: deletion(third) }]);
    await step("BP05 delete missing operation", () => mutate(moved.operationId, () => api.deleteCalendarEventLinks(moved.operationId)), []);
    await step("BP09 matching delete", () => mutate(duplicate.operationId, () => api.deleteMatchingCalendarEventLink(duplicate)), [{ action: "delete", changes: deletion(duplicate) }]);
    await step("BP11 no context", () => mutate(link.operationId, () => api.saveCalendarEventLink(link), false), []);
    await step("BP11 no-context update", () => mutate(link.operationId, () => api.saveCalendarEventLink(changed), false), []);
    await step("BP11 no-context delete", () => mutate(link.operationId, () => api.deleteCalendarEventLinks(link.operationId), false), []);
    const beforeInvalid = await raw();
    await assert.rejects(() => mutate(link.operationId, () => api.saveCalendarEventLink({ ...link, eventDate: "not-a-date" })));
    assert.deepEqual(await raw(), beforeInvalid, "invalid date rollback");
    await seedTimestamps();
    assert.deepEqual(await api.findOperationUpdatedAt([]), new Map());
    assert.deepEqual(await api.findOperationUpdatedAt(["unknown"]), new Map());
    const times = await api.findOperationUpdatedAt(["time-active", "time-deleted", "time-active", "unknown", "time-equal"]);
    const expected = new Map([["time-active", new Date("2030-02-01T03:04:05Z")], ["time-deleted", new Date("2030-02-02T03:04:05Z")], ["time-equal", new Date("2030-02-01T03:04:05Z")]]);
    assert.deepEqual(times, expected); ledger.push({ name: "BT01 timestamp", value: [...times].sort(([a],[b]) => a.localeCompare(b)).map(([id,date]) => [id,date.toISOString()]) });
    return ledger;
  } finally {
    await prisma?.$disconnect();
    if (client) { try { if (mongoOwned) { assert.match(databaseName, /^hub_om_shadow_calendar_oracle_[a-f0-9]{20}$/); await client.db(databaseName).dropDatabase(); } } finally { await client.close(); } }
    await pgOwned?.close();
  }
}
run().then(async ledger => { await send({ kind: "result", ledger }); process.disconnect?.(); }).catch(async error => {
  await send({ kind: "failure", message: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; process.disconnect?.();
});
