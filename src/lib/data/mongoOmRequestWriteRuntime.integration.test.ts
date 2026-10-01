import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { getDataRepositoryOverride, runWithDataRepositories } from "./dataRepositoryContext";
import { CALENDAR_ID, PRIVATE_MARKER, SyntheticCalendarRemote } from "./mongoCalendarHandlers.fixture";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_OM_REQUEST_WRITE_MODELS, openMongoOmRequestWriteRuntime, prepareMongoOmRequestWriteRuntime } from "./mongoOmRequestWriteRuntime";
import { omRequestManagerName, type OmRequestInput } from "./omRequest/omRequestTypes";

const uri = process.env.MONGODB_OM_REQUEST_WRITE_RUNTIME_TEST_URI;
const author = { email: "synthetic.write.author@day1company.co.kr", name: "Synthetic write author" };
const manager = { email: "synthetic.write.manager@day1company.co.kr", name: omRequestManagerName("1파트")! };
const admin = { email: "synthetic.write.admin@day1company.co.kr", name: "Synthetic write admin" };
let actor: typeof author | null = author;
const remotes = new AsyncLocalStorage<SyntheticCalendarRemote>();
const compositionAdded: string[][] = [], compositionCreated: Array<Record<string, unknown>> = [], compositionCalendar: string[] = [], compositionAssigned: Array<Record<string, unknown>> = [];
let failCompositionTools = false, failCompositionCreated = false, failCompositionCalendar = false, failCompositionAssigned = false;
const compositionTools = { list: () => ["Synthetic known tool"], add(names: string[]) { compositionAdded.push([...names]); if (failCompositionTools) throw new Error(`${PRIVATE_MARKER}-composition-tools`); } };
const compositionRequestNotifier = { async notifyCreated(value: Record<string, unknown>) { compositionCreated.push(structuredClone(value)); if (failCompositionCreated) throw new Error(`${PRIVATE_MARKER}-composition-created`); return { channel: "COMPOSITION", ts: "2.0" }; } };
const compositionAssignmentCalendar = { async reflectOperationUpdated(operation: { operationId: string }) { compositionCalendar.push(operation.operationId); if (failCompositionCalendar) throw new Error(`${PRIVATE_MARKER}-composition-calendar`); } };
const compositionAssignmentNotifier = { async notifyAssigned(value: Record<string, unknown>) { compositionAssigned.push(structuredClone(value)); if (failCompositionAssigned) throw new Error(`${PRIVATE_MARKER}-composition-assigned`); } };
mock.module("@/auth", { namedExports: { auth: async () => actor ? { user: actor, expires: "" } : null } });
mock.module("@/lib/data/omRequest/omCustomToolsLocalRepository", { namedExports: {
  getOmCustomToolsRepository: () => getDataRepositoryOverride("omCustomTools") ?? compositionTools,
  listCustomTools: () => (getDataRepositoryOverride("omCustomTools") ?? compositionTools).list(),
  addCustomTools: (names: string[]) => (getDataRepositoryOverride("omCustomTools") ?? compositionTools).add(names)
} });
mock.module("@/lib/data/omRequest/omRequestRepositoryFactory", { namedExports: {
  getOmRequestRepository: () => getDataRepositoryOverride("omRequests")!,
  getOmRequestNotifier: () => getDataRepositoryOverride("omRequestNotifier") ?? compositionRequestNotifier
} });
mock.module("@/lib/data/omRequest/omAssignmentEffects", { namedExports: {
  getOmAssignmentCalendar: () => getDataRepositoryOverride("omAssignmentCalendar") ?? compositionAssignmentCalendar,
  getOmAssignmentNotifier: () => getDataRepositoryOverride("omAssignmentNotifier") ?? compositionAssignmentNotifier
} });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
const hooks = registerHooks({ resolve(specifier, context, next) { return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context); } });
const [collectionRoute, itemRoute, assignmentRoute] = await Promise.all([
  import("../../app/api/om-request/route"), import("../../app/api/om-request/[id]/route"), import("../../app/api/om-request/assign/route")
]);
const { resetAccessTokenCache } = await import("../googleCalendar/calendarWriteClient");
hooks.deregister();

function input(courseName = "Synthetic write course"): OmRequestInput {
  return { team: "1파트", ld: author.name, company: "Synthetic write company", trainingType: "오프라인", courseId: "SYN-WRITE", courseName,
    courseCategory: "Synthetic category", instructorName: "Synthetic write instructor", syncupLink: "https://example.invalid/write-syncup",
    driveLink: "https://example.invalid/write-drive", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "N", coachRequest: "N",
    resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-07-01", timeStart: "09:00", timeEnd: "10:00", duration: "1",
      location: "Synthetic write room" }], notes: "Synthetic write note" };
}
function request(method: string, body: unknown) {
  return new Request("https://example.invalid/api/om-request", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function snapshot(store: MongoOperationStore) {
  const rows: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    rows[item.name] = { definition: item, indexes: (await collection.indexes()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), documents: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return rows;
}

test("OM request create, edit, assignment and delete handlers run in one locked Calendar-aware Mongo runtime", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { AUTH_SECRET: randomBytes(32).toString("base64"), DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres",
    DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: admin.email, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret",
    GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID}`,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_DRIVE_PRIVATE_KEY: "", GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "",
    GOOGLE_CALENDAR_PRIVATE_KEY: "", SLACK_BOT_TOKEN: "", SLACK_SEARCH_TOKEN: "", SLACK_CALENDAR_ALERT_EMAIL: "" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const remote = new SyntheticCalendarRemote(); let unscopedFetch = 0;
  const logs: string[] = [], recordLog = (...values: unknown[]) => { logs.push(values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); };
  const errorMock = mock.method(console, "error", recordLog);
  const fetchMock = mock.method(globalThis, "fetch", async (source: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const scoped = remotes.getStore(); if (!scoped) { unscopedFetch++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); } return scoped.fetch(source, init);
  });
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutating.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_om_write_${randomBytes(8).toString("hex")}`, namespace = `shadow_om_write_${randomBytes(6).toString("hex")}`;
  const tools = ["Synthetic known tool"], added: string[][] = [], createdNotifications: Array<Record<string, unknown>> = [];
  const assignedNotifications: Array<Record<string, unknown>> = [], calendarOperations: string[] = [];
  let failTools = false, failCreatedNotifier = false, failAssignmentCalendar = false, failAssignmentNotifier = false;
  try {
    await client.connect(); resetAccessTokenCache();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0,
      omCustomTools: { list: () => [...tools], add: (names: string[]) => { added.push([...names]); if (failTools) throw new Error(`${PRIVATE_MARKER}-tools`); tools.push(...names); } },
      omRequestNotifier: { async notifyCreated(value: Record<string, unknown>) { createdNotifications.push(structuredClone(value)); if (failCreatedNotifier) throw new Error(`${PRIVATE_MARKER}-created`); return { channel: "SYNTHETIC", ts: "1.0" }; } },
      omAssignmentCalendar: { async reflectOperationUpdated(operation: { operationId: string }) { calendarOperations.push(operation.operationId); if (failAssignmentCalendar) throw new Error(`${PRIVATE_MARKER}-assignment-calendar`); } },
      omAssignmentNotifier: { async notifyAssigned(value: Record<string, unknown>) { assignedNotifications.push(structuredClone(value)); if (failAssignmentNotifier) throw new Error(`${PRIVATE_MARKER}-assigned`); } } };
    const runtime = await prepareMongoOmRequestWriteRuntime(options), store = new MongoOperationStore(options, MONGO_OM_REQUEST_WRITE_MODELS);
    const invoke = <T>(work: () => T): T => runtime.run(() => remotes.run(remote, work));
    const ready = await snapshot(store); writes.length = 0; await prepareMongoOmRequestWriteRuntime(options); await openMongoOmRequestWriteRuntime(options);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const second = await prepareMongoOmRequestWriteRuntime({ ...options, namespace: `shadow_om_write_second_${randomBytes(6).toString("hex")}` }); let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);
    await runtime.repositories.teamUsers.createTeamUser({ name: author.name, email: author.email, slackId: "author", team: "AX 1파트", role: "ld" });
    await runtime.repositories.teamUsers.createTeamUser({ name: manager.name, email: manager.email, slackId: "manager", team: "AX 1파트", role: "om" });

    const privateValues = [author.email, author.name, manager.email, manager.name, "Synthetic write instructor", "https://example.invalid/write-syncup",
      "https://example.invalid/write-drive", "Synthetic write room", "Synthetic write note", "Synthetic assigned OM"];
    async function assertPrivateStorage() { const raw = JSON.stringify(await snapshot(store)); for (const secret of privateValues) assert.equal(raw.includes(secret), false); }
    async function assertAudit(response: Response, route: string, method: string, status: number, expected: typeof author) {
      assert.equal(response.status, status); const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row); assert.equal(row.route, route); assert.equal(row.method, method); assert.equal(row.status, status);
      assert.equal(row.actorType, "user"); assert.equal(row.actorEmail, expected.email); assert.equal(row.actorName, expected.name);
    }

    actor = author;
    const createdResponse = await invoke(() => collectionRoute.POST(request("POST", { ...input(), tools: "Synthetic new tool" })));
    await assertAudit(createdResponse, "/api/om-request", "POST", 201, author); const created = await createdResponse.json(); assert.ok(created.id); assert.ok(created.operationId);
    assert.equal(remote.active().length, 1); assert.equal((await store.scan("CalendarEventLink", { operationId: created.operationId })).length, 1);
    assert.deepEqual(added, [["Synthetic new tool"]]); assert.equal(createdNotifications.length, 1); assert.equal(createdNotifications[0].ldEmail, author.email);
    assert.deepEqual(createdNotifications[0].sessions, input().sessions); assert.equal(created.slackChannel, "SYNTHETIC"); assert.equal(created.slackThreadTs, "1.0");
    await assertPrivateStorage();

    const editedResponse = await invoke(() => itemRoute.PATCH(request("PATCH", input("Synthetic edited course")), { params: Promise.resolve({ id: created.id }) }));
    await assertAudit(editedResponse, "/api/om-request/[id]", "PATCH", 200, author); assert.equal((await editedResponse.json()).courseName, "Synthetic edited course");
    await assertPrivateStorage();

    actor = manager;
    const previewResponse = await invoke(() => assignmentRoute.POST(request("POST", { id: created.id, assignedOm: "Synthetic assigned OM" })));
    await assertAudit(previewResponse, "/api/om-request/assign", "POST", 200, manager); const preview = (await previewResponse.json()).preview; assert.ok(preview.token); assert.equal(preview.count, 1);
    const assignedResponse = await invoke(() => assignmentRoute.PATCH(request("PATCH", { id: created.id, assignedOm: "Synthetic assigned OM", confirmationToken: preview.token })));
    await assertAudit(assignedResponse, "/api/om-request/assign", "PATCH", 200, manager); assert.equal((await assignedResponse.json()).assignedOm, "Synthetic assigned OM");
    assert.deepEqual(calendarOperations, [created.operationId]); assert.equal(assignedNotifications.length, 1); assert.deepEqual(assignedNotifications[0], {
      company: "Synthetic write company", courseName: "Synthetic edited course", assignedOm: "Synthetic assigned OM", ld: author.name, ldEmail: author.email,
      channel: "SYNTHETIC", threadTs: "1.0"
    });
    await assertPrivateStorage();

    actor = admin;
    const deletedResponse = await invoke(() => itemRoute.DELETE(request("DELETE", {}), { params: Promise.resolve({ id: created.id }) }));
    await assertAudit(deletedResponse, "/api/om-request/[id]", "DELETE", 200, admin); assert.deepEqual(await deletedResponse.json(), { ok: true });

    const toolsBeforeFailure = added.length, createdBeforeFailure = createdNotifications.length;
    failTools = failCreatedNotifier = true; actor = author;
    const failedEffectsResponse = await invoke(() => collectionRoute.POST(request("POST", { ...input("Synthetic effect failure course"), tools: "Synthetic failing tool" })));
    await assertAudit(failedEffectsResponse, "/api/om-request", "POST", 201, author); const failedEffects = await failedEffectsResponse.json(); assert.ok(failedEffects.id); assert.ok(failedEffects.operationId);
    assert.equal(added.length, toolsBeforeFailure + 1); assert.deepEqual(added.at(-1), ["Synthetic failing tool"]);
    assert.equal(createdNotifications.length, createdBeforeFailure + 1); assert.equal(createdNotifications.at(-1)?.courseName, "Synthetic effect failure course");
    assert.equal(createdNotifications.at(-1)?.ldEmail, author.email); assert.deepEqual(createdNotifications.at(-1)?.sessions, input().sessions);
    assert.ok(await runtime.repositories.omRequests.getOmRequest(failedEffects.id)); assert.ok(await runtime.repositories.operations.getOperationById(failedEffects.operationId));
    failTools = failCreatedNotifier = false; actor = manager;
    const failedPreviewResponse = await invoke(() => assignmentRoute.POST(request("POST", { id: failedEffects.id, assignedOm: "Synthetic assigned OM" })));
    await assertAudit(failedPreviewResponse, "/api/om-request/assign", "POST", 200, manager); const failedPreview = (await failedPreviewResponse.json()).preview;
    const calendarBeforeFailure = calendarOperations.length, assignedBeforeFailure = assignedNotifications.length;
    failAssignmentCalendar = failAssignmentNotifier = true;
    const failedAssignmentResponse = await invoke(() => assignmentRoute.PATCH(request("PATCH", { id: failedEffects.id, assignedOm: "Synthetic assigned OM", confirmationToken: failedPreview.token })));
    await assertAudit(failedAssignmentResponse, "/api/om-request/assign", "PATCH", 200, manager); assert.equal((await failedAssignmentResponse.json()).assignedOm, "Synthetic assigned OM");
    assert.equal(calendarOperations.length, calendarBeforeFailure + 1); assert.equal(calendarOperations.at(-1), failedEffects.operationId);
    assert.equal(assignedNotifications.length, assignedBeforeFailure + 1); assert.deepEqual(assignedNotifications.at(-1), {
      company: "Synthetic write company", courseName: "Synthetic effect failure course", assignedOm: "Synthetic assigned OM", ld: author.name,
      ldEmail: author.email, channel: undefined, threadTs: undefined
    });
    assert.equal((await runtime.repositories.omRequests.getOmRequest(failedEffects.id))?.assignedOm, "Synthetic assigned OM");
    assert.equal(logs.join("\n").includes(PRIVATE_MARKER), false); await assertPrivateStorage();

    assert.equal(pgCalls, 0); assert.equal(unscopedFetch, 0); assert.deepEqual(remote.violations, []);
    const partialNamespace = `shadow_om_write_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`); await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partialBefore = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoOmRequestWriteRuntime({ ...options, namespace: partialNamespace }), /MONGO_OM_REQUEST_WRITE_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(row => row.commandName), []); assert.deepEqual(await snapshot(partial), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore(); errorMock.mock.restore(); resetAccessTokenCache();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

const compositionUri = process.env.MONGODB_OM_REQUEST_WRITE_COMPOSITION_TEST_URI;
test("OM request routes use the prepared Mongo composition", { skip: !compositionUri, timeout: 180_000 }, async () => {
  const target = new URL(compositionUri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_om_write_comp_${randomBytes(6).toString("hex")}`, namespace = `shadow_om_write_comp_${randomBytes(6).toString("hex")}`;
  const env = { OM_REQUEST_WRITE_BACKEND: "mongodb-shadow", MONGODB_URI: compositionUri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace,
    AUTH_SECRET: randomBytes(32).toString("base64"), DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: admin.email,
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false",
    GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-calendar-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-calendar-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-calendar-refresh", GOOGLE_CAL_PART_CALENDARS: `1파트:${CALENDAR_ID}`,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_DRIVE_PRIVATE_KEY: "", GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: "", GOOGLE_CALENDAR_PRIVATE_KEY: "", SLACK_BOT_TOKEN: "", SLACK_SEARCH_TOKEN: "", SLACK_CALENDAR_ALERT_EMAIL: "" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(compositionUri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const remote = new SyntheticCalendarRemote(); let unscopedFetch = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (source: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => { const scoped = remotes.getStore(); if (!scoped) { unscopedFetch++; throw new Error("EXTERNAL_FETCH_TRIPWIRE"); } return scoped.fetch(source, init); });
  const logs: string[] = [], errorMock = mock.method(console, "error", (...values: unknown[]) => { logs.push(values.map(String).join(" ")); });
  try {
    compositionAdded.length = compositionCreated.length = compositionCalendar.length = compositionAssigned.length = 0;
    failCompositionTools = failCompositionCreated = failCompositionCalendar = failCompositionAssigned = false;
    await client.connect(); resetAccessTokenCache();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0,
      omCustomTools: { list: () => [], add: () => {} }, omRequestNotifier: { async notifyCreated() { return null; } },
      omAssignmentCalendar: { async reflectOperationUpdated() {} }, omAssignmentNotifier: { async notifyAssigned() {} } };
    const runtime = await prepareMongoOmRequestWriteRuntime(options), store = new MongoOperationStore(options, MONGO_OM_REQUEST_WRITE_MODELS);
    await runtime.repositories.teamUsers.createTeamUser({ name: author.name, email: author.email, slackId: "author", team: "AX 1파트", role: "ld" });
    await runtime.repositories.teamUsers.createTeamUser({ name: manager.name, email: manager.email, slackId: "manager", team: "AX 1파트", role: "om" });
    const invoke = <T>(work: () => T): T => remotes.run(remote, work);
    actor = author;
    const createdResponse = await invoke(() => collectionRoute.POST(request("POST", { ...input(), tools: "Synthetic composition tool" }))); assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json(); assert.ok(created.id); assert.ok(created.operationId); const createdAuditId = createdResponse.headers.get("X-Request-Id"); assert.ok(createdAuditId); assert.ok(await store.one("ActivityRequest", { _id: createdAuditId }));
    assert.deepEqual(compositionAdded, [["Synthetic composition tool"]]); assert.equal(compositionCreated.length, 1); assert.equal(compositionCreated[0].courseName, "Synthetic write course"); assert.equal(compositionCreated[0].ldEmail, author.email); assert.deepEqual(compositionCreated[0].sessions, input().sessions); assert.equal(created.slackChannel, "COMPOSITION"); assert.equal(created.slackThreadTs, "2.0");
    const editedResponse = await invoke(() => itemRoute.PATCH(request("PATCH", input("Synthetic composition edit")), { params: Promise.resolve({ id: created.id }) })); assert.equal(editedResponse.status, 200);
    actor = manager;
    const previewResponse = await invoke(() => assignmentRoute.POST(request("POST", { id: created.id, assignedOm: "Synthetic assigned OM" }))); assert.equal(previewResponse.status, 200); const preview = (await previewResponse.json()).preview; assert.ok(preview.token);
    const assignedResponse = await invoke(() => assignmentRoute.PATCH(request("PATCH", { id: created.id, assignedOm: "Synthetic assigned OM", confirmationToken: preview.token }))); assert.equal(assignedResponse.status, 200); assert.equal((await assignedResponse.json()).assignedOm, "Synthetic assigned OM");
    assert.deepEqual(compositionCalendar, [created.operationId]); assert.equal(compositionAssigned.length, 1); assert.deepEqual(compositionAssigned[0], { company: "Synthetic write company", courseName: "Synthetic composition edit", assignedOm: "Synthetic assigned OM", ld: author.name, ldEmail: author.email, channel: "COMPOSITION", threadTs: "2.0" });
    actor = admin; const deletedResponse = await invoke(() => itemRoute.DELETE(request("DELETE", {}), { params: Promise.resolve({ id: created.id }) })); assert.equal(deletedResponse.status, 200);
    for (const response of [editedResponse, previewResponse, assignedResponse, deletedResponse]) { const auditId = response.headers.get("X-Request-Id"); assert.ok(auditId); assert.ok(await store.one("ActivityRequest", { _id: auditId })); }
    failCompositionTools = failCompositionCreated = true; actor = author;
    const failedEffectsResponse = await invoke(() => collectionRoute.POST(request("POST", { ...input("Synthetic composition failure"), tools: "Synthetic failing composition tool" }))); assert.equal(failedEffectsResponse.status, 201); const failedEffects = await failedEffectsResponse.json(); assert.ok(failedEffects.id); assert.ok(failedEffects.operationId); assert.deepEqual(compositionAdded.at(-1), ["Synthetic failing composition tool"]); assert.equal(compositionCreated.at(-1)?.courseName, "Synthetic composition failure"); assert.ok(await runtime.repositories.omRequests.getOmRequest(failedEffects.id));
    failCompositionTools = failCompositionCreated = false; failCompositionCalendar = failCompositionAssigned = true; actor = manager;
    const failedPreviewResponse = await invoke(() => assignmentRoute.POST(request("POST", { id: failedEffects.id, assignedOm: "Synthetic assigned OM" }))); assert.equal(failedPreviewResponse.status, 200); const failedPreview = (await failedPreviewResponse.json()).preview;
    const failedAssignmentResponse = await invoke(() => assignmentRoute.PATCH(request("PATCH", { id: failedEffects.id, assignedOm: "Synthetic assigned OM", confirmationToken: failedPreview.token }))); assert.equal(failedAssignmentResponse.status, 200); assert.equal((await failedAssignmentResponse.json()).assignedOm, "Synthetic assigned OM"); assert.equal(compositionCalendar.at(-1), failedEffects.operationId); assert.equal(compositionAssigned.at(-1)?.courseName, "Synthetic composition failure"); assert.equal((await runtime.repositories.omRequests.getOmRequest(failedEffects.id))?.assignedOm, "Synthetic assigned OM"); assert.equal(logs.join("\n").includes(PRIVATE_MARKER), false);
    assert.equal(pgCalls, 0); assert.equal(unscopedFetch, 0); assert.deepEqual(remote.violations, []);
    const partialNamespace = `shadow_om_write_comp_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`); await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" }); const before = await snapshot(partial);
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace; await assert.rejects(invoke(() => collectionRoute.POST(request("POST", input()))), /OM_REQUEST_WRITE_COMPOSITION_FAILED/); assert.deepEqual(await snapshot(partial), before);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore(); errorMock.mock.restore(); resetAccessTokenCache();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
