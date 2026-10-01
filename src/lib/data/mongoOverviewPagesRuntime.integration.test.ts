import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import ts from "typescript";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_OVERVIEW_PAGES_MODELS, openMongoOverviewPagesRuntime, prepareMongoOverviewPagesRuntime } from "./mongoOverviewPagesRuntime";
import type { CreateOperationInput } from "./operationTypes";

const uri = process.env.MONGODB_OVERVIEW_PAGES_TEST_URI;
const user = { email: "overview.operator@day1company.co.kr", name: "Synthetic overview operator" };
mock.module("@/auth", { namedExports: { auth: async () => ({ user, expires: "" }) } });
mock.module("@/lib/sourceReads", { namedExports: { getOperationSourceReader: async () => ({ readCalendarEvents: async () => ({ source: "calendar", status: "disabled", readAt: new Date(0).toISOString(), items: [], issues: [] }) }) } });
let pgAdapterCalls = 0, pgPoolCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgAdapterCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
    return next(specifier === "next/navigation" || specifier === "next/server" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) { if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }; return next(url, context); }
});
const [{ default: dashboardPage }, { default: mePage }, { default: wikiPage }, { default: resourcesPage }] = await Promise.all([
  import("../../app/dashboard/page"), import("../../app/me/page"), import("../../app/company-wiki/page"), import("../../app/resources/page")
]);
hooks.deregister();

function operationInput(): CreateOperationInput { return { archiveStatus: "아카이빙전", coach: "", companyName: "Synthetic overview company", companyWikiLink: "", costRaw: "", courseId: "SYN-OVERVIEW", courseName: "Synthetic overview course", createdBy: user.email, driveLink: "", educationDays: "1", educationDates: ["2099-05-03"], educationFormat: "오프라인", endDate: "2099-05-03", instructorCost: null, instructorWikiLink: "", instructors: "", ld: "", lectureManagementLink: "", om: user.name, onsiteRequired: "N", operationCost: null, operationDetail: "", operationIssue: "", operationStatus: "배정필요", operationType: "단기", padletLink: "", region: "", resultReportLink: "", revenue: null, roundNo: "1", specialNotes: "", startDate: "2099-05-03", timeText: "09:00-10:00", totalCost: null }; }
function props(element: ReactElement) { return element.props as Record<string, unknown>; }
async function snapshot(store: MongoOperationStore) {
  const collections: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    collections[item.name] = {
      definition: item,
      indexes: (await collection.indexes()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
      rows: await collection.find({}).sort({ _id: 1 }).toArray()
    };
  }
  return collections;
}

test("dashboard, me, company wiki and resources pages share one read-only Mongo scope", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const databaseName = `hub_om_shadow_overview_pages_${randomBytes(8).toString("hex")}`, namespace = `shadow_overview_pages_${randomBytes(6).toString("hex")}`;
  const env = { OVERVIEW_PAGES_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace, DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: user.email, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge"))); if (mutating.has(event.commandName) || output) writes.push(event); });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0 };
    const runtime = await prepareMongoOverviewPagesRuntime(options), store = new MongoOperationStore(options, MONGO_OVERVIEW_PAGES_MODELS);
    const ready = await snapshot(store); writes.length = 0; await prepareMongoOverviewPagesRuntime(options); await openMongoOverviewPagesRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const blockedOptions = { ...options, allowShadowWrites: false };
    await assert.rejects(openMongoOverviewPagesRuntime(blockedOptions as unknown as Parameters<typeof openMongoOverviewPagesRuntime>[0]), /MONGO_OVERVIEW_PAGES_RUNTIME_FAILED/);
    await assert.rejects(prepareMongoOverviewPagesRuntime(blockedOptions as unknown as Parameters<typeof prepareMongoOverviewPagesRuntime>[0]), /MONGO_OVERVIEW_PAGES_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    const second = await prepareMongoOverviewPagesRuntime({ ...options, namespace: `shadow_overview_pages_second_${randomBytes(6).toString("hex")}` }); let nested = 0;
    assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) { const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key]; assert.throws(() => runWithDataRepositories(partial, () => { nested++; }), /CALENDAR_SCOPE_MISMATCH/); }
    const operation = await runtime.repositories.operations.createOperation(operationInput());
    await runtime.repositories.teamUsers.createTeamUser({ name: user.name, email: user.email, slackId: "synthetic-overview", team: "AX 1파트", role: "om" });
    const member = coachFixtureRow("Member", { name: user.name, sourceTeam: "TEAM_1", role: null, isActive: true, displayOrder: 0 });
    await store.collection("Member").insertOne(encodeMongoRuntimeDocument("Member", member));
    const request = await runtime.repositories.omRequests.createOmRequest({ team: "1팀", ld: "", company: "Synthetic pending company", trainingType: "오프라인", courseId: "SYN-PENDING", courseName: "Synthetic pending course", courseCategory: "", instructorName: "", syncupLink: "", driveLink: "", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "N", coachRequest: "N", resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-05-04", timeStart: "10:00", timeEnd: "11:00", duration: "1", location: "" }], notes: "" });
    const requestRow = await store.one("OmRequest", { _id: request.id }); assert.ok(requestRow);
    await store.collection("OmRequest").replaceOne({ _id: request.id }, encodeMongoRuntimeDocument("OmRequest", { ...requestRow, assignedOm: user.name, operationId: null }));
    const before = await snapshot(store); writes.length = 0;
    const rendered = { dashboard: await dashboardPage({ searchParams: Promise.resolve({}) }), me: await mePage(), wiki: await wikiPage(), resources: await resourcesPage({ searchParams: Promise.resolve({}) }) };
    assert.equal((props(rendered.dashboard).operations as unknown[]).length, 1); assert.equal((props(rendered.dashboard).teamUsers as unknown[]).length, 1);
    assert.equal(props(rendered.me).omName, user.name); assert.equal((props(rendered.me).operations as unknown[]).length, 1); assert.equal((props(rendered.me).assignedRequests as unknown[]).length, 1);
    assert.equal((props(rendered.wiki).entries as unknown[]).length, 1); assert.equal(props(rendered.wiki).loadFailed, false);
    assert.equal((props(rendered.resources).operations as unknown[]).length, 1); assert.equal((props(rendered.resources).pendingOmRequests as unknown[]).length, 1); assert.deepEqual(props(rendered.resources).calendarEvents, []);
    assert.deepEqual(props(rendered.resources).ownerRoster, { "1팀": [], "2팀": [], "미분류": [user.name] }); assert.deepEqual(props(rendered.resources).partRoster, { "1파트": [user.name] });
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), before); assert.equal(pgAdapterCalls, 0); assert.equal(pgPoolCalls, 0); assert.ok(operation.operationId);
    const partialNamespace = `shadow_overview_pages_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`); await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" }); const partialBefore = await snapshot(partial); writes.length = 0;
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace; await assert.rejects(dashboardPage({ searchParams: Promise.resolve({}) }), /OVERVIEW_PAGES_COMPOSITION_FAILED/); assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
