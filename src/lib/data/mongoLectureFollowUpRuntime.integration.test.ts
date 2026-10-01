import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_LECTURE_FOLLOW_UP_MODELS, openMongoLectureFollowUpRuntime, prepareMongoLectureFollowUpRuntime } from "./mongoLectureFollowUpRuntime";
import type { CreateOperationInput } from "./operationTypes";
import { kstDateString, shiftDateString } from "../reminders/reminderDates";

const uri = process.env.MONGODB_LECTURE_FOLLOW_UP_RUNTIME_TEST_URI;
const admin = { email: "synthetic.reminder.admin@day1company.co.kr", name: "Synthetic reminder admin" };
let actor: { email: string; name: string } | null = admin;
mock.module("@/auth", { namedExports: { auth: async () => actor ? { user: actor, expires: "" } : null } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const route = await import("../../app/api/reminders/lecture-followup/route");
hooks.deregister();

const PRIVATE_MARKER = "synthetic-reminder-private-marker";
function operation(date: string, om: string, suffix: string): CreateOperationInput {
  return { archiveStatus: "아카이빙전", coach: "", companyName: `Synthetic reminder company ${suffix}`, companyWikiLink: "", costRaw: "",
    courseId: "", courseName: `Synthetic reminder course ${suffix}`, driveLink: "", educationDays: "1", educationDates: [date],
    educationFormat: "오프라인", endDate: date, instructorCost: null, instructorWikiLink: "", instructors: "Synthetic reminder instructor",
    ld: "Synthetic reminder LD", lectureManagementLink: "", om, onsiteRequired: "N", operationCost: null, operationDetail: "",
    operationIssue: "", operationStatus: "진행중", operationType: "검토필요", padletLink: "", region: "Synthetic reminder room",
    resultReportLink: "", revenue: null, roundNo: suffix, specialNotes: "", startDate: date, timeText: "09:00 ~ 10:00", totalCost: null };
}
async function snapshot(store: MongoOperationStore) {
  const rows: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: true }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    rows[item.name] = await store.db.collection(item.name).find({}).sort({ _id: 1 }).toArray();
  }
  return rows;
}

test("lecture follow-up GET/POST use one locked Mongo scope and explicit send/log ports", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const localLog = `/private/tmp/hub-om-reminder-tripwire-${randomBytes(8).toString("hex")}.json`;
  const env = { AUTH_SECRET: randomBytes(32).toString("base64"), DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden",
    OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: admin.email, SYNC_API_SECRET: "synthetic-reminder-secret",
    SLACK_REMINDER_ONLY_EMAILS: "ALL", SLACK_REMINDER_START_DATE: "", REMINDER_MAX_DM_PER_RUN: "50",
    HUB_OM_BASE_URL: "https://synthetic-reminder.example.invalid", REMINDER_SENT_LOG_FILE: localLog, SLACK_BOT_TOKEN: PRIVATE_MARKER,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutating.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_reminder_${randomBytes(8).toString("hex")}`, namespace = `shadow_reminder_${randomBytes(6).toString("hex")}`;
  const sends: Array<{ slackId: string; message: string }> = [];
  let deliver = true, throwSlackId: string | null = null, fetchCalls = 0;
  let sendEntered: (() => void) | undefined, releaseSend: (() => void) | undefined;
  let sendWait: Promise<void> | undefined;
  const logs: string[] = [], errorMock = mock.method(console, "error", (...values: unknown[]) => logs.push(values.map(String).join(" ")));
  const fetchMock = mock.method(globalThis, "fetch", async () => { fetchCalls++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); });
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0,
      lectureFollowUpNotifier: { async send(slackId: string, message: string) {
        sends.push({ slackId, message });
        sendEntered?.();
        if (sendWait) await sendWait;
        if (slackId === throwSlackId) throw new Error(PRIVATE_MARKER);
        return deliver;
      } } };
    const runtime = await prepareMongoLectureFollowUpRuntime(options), store = new MongoOperationStore(options, MONGO_LECTURE_FOLLOW_UP_MODELS);
    const ready = await snapshot(store); writes.length = 0; await prepareMongoLectureFollowUpRuntime(options); await openMongoLectureFollowUpRuntime(options);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const second = await prepareMongoLectureFollowUpRuntime({ ...options, namespace: `shadow_reminder_second_${randomBytes(6).toString("hex")}` }); let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);

    const omName = "Synthetic Reminder OM";
    await runtime.repositories.teamUsers.createTeamUser({ name: omName, email: "synthetic.reminder.om@day1company.co.kr", slackId: "SYNTHETIC-REMINDER-OM", team: "AX 1파트", role: "om" });
    const today = kstDateString();
    const d1 = await runtime.repositories.operations.createOperation(operation(shiftDateString(today, -1), omName, "1"));
    const d7 = await runtime.repositories.operations.createOperation(operation(shiftDateString(today, -7), omName, "2"));

    async function audit(response: Response, method: string, status: number, actorType: string, email: string | null) {
      assert.equal(response.status, status); const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row); assert.equal(row.route, "/api/reminders/lecture-followup");
      assert.equal(row.method, method); assert.equal(row.status, status); assert.equal(row.actorType, actorType); assert.equal(row.actorEmail, email);
    }

    const previewResponse = await runtime.run(() => route.GET(new Request("https://example.invalid/api/reminders/lecture-followup")));
    await audit(previewResponse, "GET", 200, "user", admin.email); const preview = await previewResponse.json();
    assert.equal(preview.dryRun, true); assert.equal(preview.matchedSessions, 2); assert.equal(preview.recipients.length, 1);
    assert.deepEqual(preview.recipients[0].tasks.map((task: { operationId: string }) => task.operationId), [d1.operationId, d7.operationId]);
    assert.equal(sends.length, 0); assert.equal(existsSync(localLog), false);

    const postRequest = () => new Request("https://example.invalid/api/reminders/lecture-followup", {
      method: "POST", headers: { Authorization: "Bearer synthetic-reminder-secret" }
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    sendEntered = entered;
    sendWait = new Promise<void>(resolve => { releaseSend = resolve; });
    const firstPost = runtime.run(() => route.POST(postRequest()));
    await enteredPromise;
    const concurrentResponse = await runtime.run(() => route.POST(postRequest()));
    await audit(concurrentResponse, "POST", 200, "token_request", null);
    const concurrent = await concurrentResponse.json();
    assert.equal(concurrent.sentCount, 0); assert.equal(concurrent.skippedAlreadySent, 2); assert.equal(sends.length, 1);
    releaseSend?.(); sendWait = undefined; sendEntered = undefined;
    const sentResponse = await firstPost; await audit(sentResponse, "POST", 200, "token_request", null);
    const sent = await sentResponse.json(); assert.equal(sent.sentCount, 1); assert.equal(sent.failedCount, 0); assert.equal(sends.length, 1);
    assert.equal(sends[0].slackId, "SYNTHETIC-REMINDER-OM"); assert.ok(sends[0].message.includes("Synthetic reminder company 1"));
    assert.ok(sends[0].message.includes("Synthetic reminder company 2"));
    const sentLogCollection = store.db.collection(`${namespace}_LectureFollowUpSentLog`);
    assert.equal(await sentLogCollection.countDocuments({ status: "sent" }), 2);
    assert.equal(existsSync(localLog), false);

    const duplicateResponse = await runtime.run(() => route.POST(postRequest())); await audit(duplicateResponse, "POST", 200, "token_request", null);
    const duplicate = await duplicateResponse.json(); assert.equal(duplicate.sentCount, 0); assert.equal(duplicate.skippedAlreadySent, 2); assert.equal(sends.length, 1);

    const secondOm = "Synthetic Reminder Failed OM";
    await runtime.repositories.teamUsers.createTeamUser({ name: secondOm, email: "synthetic.reminder.failed@day1company.co.kr", slackId: "SYNTHETIC-REMINDER-FAILED", team: "AX 1파트", role: "om" });
    await runtime.repositories.operations.createOperation(operation(shiftDateString(today, -1), secondOm, "3"));
    deliver = false;
    const failedSendResponse = await runtime.run(() => route.POST(postRequest())); await audit(failedSendResponse, "POST", 200, "token_request", null);
    const failedSend = await failedSendResponse.json(); assert.equal(failedSend.sentCount, 0); assert.equal(failedSend.failedCount, 1);
    assert.equal(sends.at(-1)?.slackId, "SYNTHETIC-REMINDER-FAILED");
    assert.equal(await sentLogCollection.countDocuments({ status: "claimed" }), 0);

    const successAfterThrowOm = "Synthetic Reminder Z Continued OM";
    await runtime.repositories.teamUsers.createTeamUser({ name: successAfterThrowOm, email: "synthetic.reminder.continued@day1company.co.kr", slackId: "SYNTHETIC-REMINDER-CONTINUED", team: "AX 1파트", role: "om" });
    await runtime.repositories.operations.createOperation(operation(shiftDateString(today, -1), successAfterThrowOm, "4"));
    deliver = true; throwSlackId = "SYNTHETIC-REMINDER-FAILED";
    const remoteErrorResponse = await runtime.run(() => route.POST(postRequest())); await audit(remoteErrorResponse, "POST", 200, "token_request", null);
    const remoteError = await remoteErrorResponse.json(); assert.equal(remoteError.sentCount, 1); assert.equal(remoteError.failedCount, 1);
    assert.deepEqual(sends.slice(-2).map(item => item.slackId), ["SYNTHETIC-REMINDER-FAILED", "SYNTHETIC-REMINDER-CONTINUED"]);
    assert.equal(logs.join("\n").includes(PRIVATE_MARKER), false); throwSlackId = null; deliver = true;

    const completeMock = mock.method(runtime.repositories.lectureFollowUpSentLog, "complete", async () => { throw new Error(PRIVATE_MARKER); });
    const sendsBeforeCompleteFailure = sends.length;
    const completeErrorResponse = await runtime.run(() => route.POST(postRequest()));
    await audit(completeErrorResponse, "POST", 500, "token_request", null);
    assert.deepEqual(await completeErrorResponse.json(), { ok: false, error: "알림을 처리하지 못했습니다." });
    assert.equal(sends.length, sendsBeforeCompleteFailure + 1); completeMock.mock.restore();
    const afterCompleteFailure = await runtime.run(() => route.POST(postRequest()));
    await audit(afterCompleteFailure, "POST", 200, "token_request", null);
    assert.equal((await afterCompleteFailure.json()).sentCount, 0); assert.equal(sends.length, sendsBeforeCompleteFailure + 1);
    assert.equal(logs.join("\n").includes(PRIVATE_MARKER), false);

    const stateBeforeDenials = await sentLogCollection.find({}).toArray(); const sendsBeforeDenials = sends.length;
    actor = null;
    const deniedGet = await runtime.run(() => route.GET(new Request("https://example.invalid/api/reminders/lecture-followup")));
    await audit(deniedGet, "GET", 500, "anonymous", null);
    const deniedPost = await runtime.run(() => route.POST(new Request("https://example.invalid/api/reminders/lecture-followup", {
      method: "POST", headers: { Authorization: "Bearer invalid" }
    })));
    await audit(deniedPost, "POST", 500, "token_request", null);
    actor = { email: "synthetic.reminder.member@day1company.co.kr", name: "Synthetic reminder member" };
    const deniedMember = await runtime.run(() => route.GET(new Request("https://example.invalid/api/reminders/lecture-followup")));
    await audit(deniedMember, "GET", 500, "user", actor.email); actor = admin;
    assert.equal(sends.length, sendsBeforeDenials); assert.deepEqual(await sentLogCollection.find({}).toArray(), stateBeforeDenials);

    const raw = JSON.stringify(await snapshot(store));
    for (const secret of [admin.email, admin.name, omName, secondOm, "synthetic.reminder.om@day1company.co.kr",
      "synthetic.reminder.failed@day1company.co.kr", "synthetic.reminder.continued@day1company.co.kr",
      successAfterThrowOm, "synthetic.reminder.member@day1company.co.kr",
      "Synthetic reminder instructor", "Synthetic reminder LD", PRIVATE_MARKER]) {
      assert.equal(raw.includes(secret), false, secret);
    }
    assert.equal(pgCalls, 0); assert.equal(fetchCalls, 0); assert.equal(existsSync(localLog), false);

    const partialNamespace = `shadow_reminder_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`); await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partialBefore = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoLectureFollowUpRuntime({ ...options, namespace: partialNamespace }), /MONGO_LECTURE_FOLLOW_UP_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.deepEqual(await snapshot(partial), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore(); errorMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
