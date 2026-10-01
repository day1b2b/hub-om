import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runSatisfactionRequest, type SatisfactionCompositionDependencies } from "./satisfactionComposition";
import { MONGO_SATISFACTION_RUNTIME_MODELS, openMongoSatisfactionRuntime, prepareMongoSatisfactionRuntime } from "./mongoSatisfactionRuntime";
import { MongoOperationStore } from "./mongoOperationStore";
import type { CreateOperationInput } from "./operationTypes";

const admin = { email: "synthetic.satisfaction.admin@day1company.co.kr", name: "Synthetic Satisfaction Admin" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user: admin, expires: "" }) } });
let pgCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgCalls++; throw new Error("PG_TRIPWIRE"); } } } });
let defaultSourceCalls = 0, defaultRows: string[][] = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const [previewRoute, applyRoute, linkRoute, roundRoute] = await Promise.all([
  import("../../app/api/admin/satisfaction/preview/route"), import("../../app/api/admin/satisfaction/apply/route"),
  import("../../app/api/admin/satisfaction/link/route"), import("../../app/api/satisfaction/round-apply/route")
]);
hooks.deregister();

const uri = process.env.MONGODB_SATISFACTION_RUNTIME_TEST_URI;
const date = "2099-11-12", courseId = "SYNTHETIC-SATISFACTION-RUNTIME", recordId = "synthetic-satisfaction-row";
function input(): CreateOperationInput {
  return { companyName: "Synthetic Satisfaction Company", courseName: "Synthetic Satisfaction Course", courseId,
    startDate: date, endDate: date, educationDates: [date], archiveStatus: "아카이빙전", operationStatus: "배정필요",
    operationType: "단기", educationFormat: "오프라인", onsiteRequired: "N", revenue: null, totalCost: null,
    instructorCost: null, operationCost: null, coach: "", companyWikiLink: "", costRaw: "", driveLink: "",
    educationDays: "1", instructorWikiLink: "", instructors: "Synthetic Satisfaction Instructor", ld: "",
    lectureManagementLink: "", om: "Synthetic Satisfaction Owner", operationDetail: "", operationIssue: "",
    padletLink: "", region: "", resultReportLink: "", roundNo: "1", specialNotes: "", timeText: "09:00-10:00",
    createdBy: admin.email };
}
async function snapshot(store: MongoOperationStore) {
  const result: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    result[item.name] = { options: item.options, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return result;
}

test("all satisfaction handlers use one prepared locked Mongo runtime", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const env = { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false",
    ADMIN_EMAILS: admin.email, SATISFACTION_MATCHING_ENABLED: "true", SATISFACTION_SHEET_URL: "https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit",
    COURSE_LOOKUP_TOKEN: "synthetic-satisfaction-secret", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutations = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { if (mutations.has(event.commandName)) writes.push(event); });
  const databaseName = `hub_om_shadow_satisfaction_runtime_${randomBytes(8).toString("hex")}`, namespace = `shadow_satisfaction_${randomBytes(6).toString("hex")}`;
  let sourceCalls = 0, fetchCalls = 0;
  const rows = [["record_id", "courseId", "client", "course", "date", "instructor", "overall"],
    [recordId, courseId, "Synthetic Satisfaction Company", "Synthetic Satisfaction Course", date, "Synthetic Satisfaction Instructor", "4.50"]];
  const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0,
    satisfactionSource: { async readRows(spreadsheetId: string, tabTitle: string) {
      sourceCalls++; assert.equal(spreadsheetId, "SYNTHETIC_SHEET"); assert.equal(tabTitle, "eduops_log"); return rows;
    } } };
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input); fetchCalls++;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-google-token", expires_in: 3600 });
    if (url.startsWith("https://sheets.googleapis.com/")) { defaultSourceCalls++; return Response.json({ values: defaultRows }); }
    throw new Error("FETCH_TRIPWIRE");
  });
  const infoLogs: string[] = [], infoMock = mock.method(console, "info", (...values: unknown[]) => { infoLogs.push(values.map(String).join(" ")); });
  try {
    await client.connect();
    const runtime = await prepareMongoSatisfactionRuntime(options), store = new MongoOperationStore(options, MONGO_SATISFACTION_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0;
    await prepareMongoSatisfactionRuntime(options); await openMongoSatisfactionRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const created = await runtime.repositories.operations.createOperation(input());

    async function post(route: { POST(request: Request): Promise<Response> }, path: string, body: Record<string, unknown>, token?: string) {
      const response = await runtime.run(() => route.POST(new Request(`https://example.invalid${path}`, {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body)
      })));
      assert.equal(response.status, 200); const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const audit = await store.one("ActivityRequest", { _id: requestId }); assert.ok(audit); assert.equal(audit.route, path); assert.equal(audit.status, 200);
      return response.json();
    }

    const preview = await post(previewRoute, "/api/admin/satisfaction/preview", {});
    assert.deepEqual(preview.stats, { total: 1, matched: 1, ambiguous: 0, unmatched: 0, operations: 1 });
    const applied = await post(applyRoute, "/api/admin/satisfaction/apply", {});
    assert.deepEqual(applied.stats, { applied: 1, skipped: 0, failed: 0 });
    assert.equal((await runtime.repositories.operations.getOperationById(created.operationId))?.avgSatisfaction, "4.50");
    const linked = await post(linkRoute, "/api/admin/satisfaction/link", { recordId, operationId: created.id });
    assert.equal(linked.applied.length, 0); assert.equal(linked.skipped.length, 1); assert.equal(linked.failed.length, 0);
    const round = await post(roundRoute, "/api/satisfaction/round-apply", { courseId, date, overall: "4.75", instructorSatisfaction: "4.25" }, "synthetic-satisfaction-secret");
    assert.equal(round.applied, true); assert.equal(round.value, "4.75");
    const final = await runtime.repositories.operations.getOperationById(created.operationId);
    assert.equal(final?.avgSatisfaction, "4.75"); assert.equal(final?.instructorSatisfaction, "4.25");
    assert.equal(sourceCalls, 3); assert.equal(fetchCalls, 0); assert.equal(pgCalls, 0);

    const compositionNamespace = `shadow_satisfaction_composition_${randomBytes(6).toString("hex")}`;
    const compositionRuntime = await prepareMongoSatisfactionRuntime({ ...options, namespace: compositionNamespace });
    const compositionStore = new MongoOperationStore({ ...options, namespace: compositionNamespace }, MONGO_SATISFACTION_RUNTIME_MODELS);
    const compositionCreated = await compositionRuntime.repositories.operations.createOperation(input()); defaultRows = rows;
    const compositionEnvironment = { ...env, SATISFACTION_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: compositionNamespace,
      GOOGLE_CAL_OAUTH_CLIENT_ID: "synthetic-client", GOOGLE_CAL_OAUTH_CLIENT_SECRET: "synthetic-secret", GOOGLE_CAL_OAUTH_REFRESH_TOKEN: "synthetic-refresh" };
    const routeSaved = new Map(Object.keys(compositionEnvironment).map(name => [name, process.env[name]])); Object.assign(process.env, compositionEnvironment);
    async function compositionPost(route: { POST(request: Request): Promise<Response> }, path: string, body: Record<string, unknown>, token?: string) {
      const response = await route.POST(new Request(`https://example.invalid${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); const id = response.headers.get("X-Request-Id"); assert.ok(id); assert.ok(await compositionStore.one("ActivityRequest", { _id: id })); return response.json();
    }
    try {
      assert.equal((await compositionPost(previewRoute, "/api/admin/satisfaction/preview", {})).stats.matched, 1);
      assert.equal((await compositionPost(applyRoute, "/api/admin/satisfaction/apply", {})).stats.applied, 1);
      assert.equal((await compositionPost(linkRoute, "/api/admin/satisfaction/link", { recordId, operationId: compositionCreated.id })).skipped.length, 1);
      assert.equal((await compositionPost(roundRoute, "/api/satisfaction/round-apply", { courseId, date, overall: "4.75", instructorSatisfaction: "4.25", manager: "private-manager@example.invalid" }, "synthetic-satisfaction-secret")).applied, true);
    } finally { for (const [name, value] of routeSaved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    assert.equal(defaultSourceCalls, 3); assert.equal(pgCalls, 0); assert.equal(fetchCalls, 4);
    for (const privateValue of [admin.email, recordId, "private-manager@example.invalid"]) assert.equal(infoLogs.join("\n").includes(privateValue), false);
    const compositionFinal = await compositionRuntime.repositories.operations.getOperationById(compositionCreated.operationId); assert.equal(compositionFinal?.avgSatisfaction, "4.75");

    const dependencies: SatisfactionCompositionDependencies = { createClient() { return new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5_000 }); }, source: options.satisfactionSource, openRuntime: input => openMongoSatisfactionRuntime({ ...input, client: input.client as MongoClient }) };
    const compositionPartialNamespace = `shadow_satisfaction_composition_partial_${randomBytes(6).toString("hex")}`, compositionPartial = new MongoOperationStore({ ...options, namespace: compositionPartialNamespace });
    await compositionPartial.db.createCollection(`${compositionPartialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" }); await compositionPartial.db.collection(`${compositionPartialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const compositionPartialBefore = await snapshot(compositionPartial); let partialWorkCalls = 0;
    await assert.rejects(runSatisfactionRequest(async () => { partialWorkCalls++; return "unexpected"; }, { ...compositionEnvironment, MONGODB_SHADOW_NAMESPACE: compositionPartialNamespace }, dependencies), /SATISFACTION_COMPOSITION_FAILED/);
    assert.equal(partialWorkCalls, 0); assert.deepEqual(await snapshot(compositionPartial), compositionPartialBefore);

    const second = await prepareMongoSatisfactionRuntime({ ...options, namespace: `shadow_satisfaction_second_${randomBytes(6).toString("hex")}` });
    let callbacks = 0; assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(callbacks, 0);

    const partialNamespace = `shadow_satisfaction_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" });
    await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" });
    const partialBefore = await snapshot(partial); writes.length = 0;
    await assert.rejects(prepareMongoSatisfactionRuntime({ ...options, namespace: partialNamespace }), /MONGO_SATISFACTION_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); fetchMock.mock.restore(); infoMock.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
