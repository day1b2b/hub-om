import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { MongoClient, type CommandStartedEvent } from "mongodb";
import ts from "typescript";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_OPERATION_PAGES_RUNTIME_MODELS, openMongoOperationPagesRuntime, prepareMongoOperationPagesRuntime } from "./mongoOperationPagesRuntime";
import type { CreateOperationInput } from "./operationTypes";
import { omRequestManagerName } from "./omRequest/omRequestTypes";

const uri = process.env.MONGODB_OM_REQUEST_PAGES_TEST_URI;
const author = { email: "synthetic.author@day1company.co.kr", name: "Synthetic request author" };
const manager = { email: "synthetic.manager@day1company.co.kr", name: omRequestManagerName("1파트")! };
const admin = { email: "synthetic.admin@day1company.co.kr", name: "Synthetic request admin" };
const outsider = { email: "synthetic.outsider@day1company.co.kr", name: "Synthetic request outsider" };
const customTools = Object.freeze({ list: () => ["Synthetic custom tool"], add: (_names: string[]) => { throw new Error("UNEXPECTED_TOOL_WRITE"); } });
let actor: typeof author | null = author;
mock.module("@/auth", { namedExports: { auth: async () => actor ? { user: actor, expires: "" } : null } });
mock.module("@/lib/data/omRequest/omCustomToolsLocalRepository", { namedExports: { getOmCustomToolsRepository: () => customTools, listCustomTools: () => customTools.list(), addCustomTools: (names: string[]) => customTools.add(names) } });
let pgAdapterCalls = 0, pgPoolCalls = 0;
mock.module("@prisma/adapter-pg", { namedExports: { PrismaPg: class { constructor() { pgAdapterCalls++; throw new Error("PG_ADAPTER_TRIPWIRE"); } } } });
mock.module("pg", { namedExports: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } }, defaultExport: { Pool: class { constructor() { pgPoolCalls++; throw new Error("PG_POOL_TRIPWIRE"); } } } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
    return next(["next/navigation", "next/script", "next/server"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) { if (url.endsWith(".css")) return { format: "module", shortCircuit: true, source: "export default {};" }; if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }; return next(url, context); }
});
const [{ default: requestPage }, { default: managePage }, { default: detailPage }, { default: editPage }, { default: completePage }] = await Promise.all([
  import("../../app/om-request/page"), import("../../app/om-request/manage/page"), import("../../app/om-request/manage/[id]/page"),
  import("../../app/om-request/manage/[id]/edit/page"), import("../../app/om-request/complete/page")
]);
hooks.deregister();

function operationInput(): CreateOperationInput { return { archiveStatus: "아카이빙전", coach: "", companyName: "Synthetic known company", companyWikiLink: "", costRaw: "", courseId: "SYN-OM-PAGE", courseName: "Synthetic known course", createdBy: author.email, driveLink: "", educationDays: "1", educationDates: ["2099-06-01"], educationFormat: "오프라인", endDate: "2099-06-01", instructorCost: null, instructorWikiLink: "", instructors: "", ld: author.name, lectureManagementLink: "", om: "", onsiteRequired: "N", operationCost: null, operationDetail: "", operationIssue: "", operationStatus: "배정필요", operationType: "단기", padletLink: "", region: "", resultReportLink: "", revenue: null, roundNo: "1", specialNotes: "", startDate: "2099-06-01", timeText: "09:00-10:00", totalCost: null }; }
function props(element: ReactElement) { return element.props as Record<string, unknown>; }
function findElement(value: unknown, name: string): ReactElement | undefined {
  if (Array.isArray(value)) { for (const child of value) { const found = findElement(child, name); if (found) return found; } return undefined; }
  if (!value || typeof value !== "object") return undefined;
  if (!("props" in value)) return undefined;
  const element = value as ReactElement; const type = element.type as { name?: string } | string;
  if ((typeof type === "string" ? type : type?.name) === name) return element;
  const children = (element.props as { children?: unknown }).children;
  for (const child of Array.isArray(children) ? children : [children]) { const found = findElement(child, name); if (found) return found; }
  return undefined;
}
function hasText(value: unknown, expected: string): boolean {
  if (typeof value === "string" || typeof value === "number") return String(value).includes(expected);
  if (Array.isArray(value)) return value.some(child => hasText(child, expected));
  if (!value || typeof value !== "object") return false;
  if (!("props" in value)) return false;
  const children = ((value as ReactElement).props as { children?: unknown }).children;
  return (Array.isArray(children) ? children : [children]).some(child => hasText(child, expected));
}
function hasPropValue(value: unknown, key: string, expected: unknown): boolean {
  if (Array.isArray(value)) return value.some(child => hasPropValue(child, key, expected));
  if (!value || typeof value !== "object" || !("props" in value)) return false;
  const elementProps = (value as ReactElement).props as Record<string, unknown>;
  if (elementProps[key] === expected) return true;
  return hasPropValue(elementProps.children, key, expected);
}
async function snapshot(store: MongoOperationStore) {
  const collections: Record<string, unknown> = {};
  for (const item of (await store.db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    const collection = store.db.collection(item.name);
    collections[item.name] = { definition: item, indexes: (await collection.indexes()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), rows: await collection.find({}).sort({ _id: 1 }).toArray() };
  }
  return collections;
}

test("OM request entry, manage, detail, edit and complete pages share one native Mongo scope", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const databaseName = `hub_om_shadow_om_request_pages_${randomBytes(8).toString("hex")}`, namespace = `shadow_om_request_pages_${randomBytes(6).toString("hex")}`;
  const env = { OM_REQUEST_PAGES_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace, DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "false", ADMIN_EMAILS: admin.email, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" };
  const saved = new Map(Object.keys(env).map(name => [name, process.env[name]])); Object.assign(process.env, env);
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [], mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => { const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge"))); if (mutating.has(event.commandName) || output) writes.push(event); });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0, omCustomTools: customTools };
    const runtime = await prepareMongoOperationPagesRuntime(options), store = new MongoOperationStore(options, MONGO_OPERATION_PAGES_RUNTIME_MODELS);
    const ready = await snapshot(store); writes.length = 0; await prepareMongoOperationPagesRuntime(options); await openMongoOperationPagesRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), ready);
    const second = await prepareMongoOperationPagesRuntime({ ...options, namespace: `shadow_om_request_pages_second_${randomBytes(6).toString("hex")}` }); let callbacks = 0;
    assert.throws(() => runtime.run(() => second.run(() => { callbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) { const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key]; assert.throws(() => runWithDataRepositories(partial, () => { callbacks++; }), /CALENDAR_SCOPE_MISMATCH/); }
    assert.equal(callbacks, 0);
    await runtime.repositories.operations.createOperation(operationInput());
    await runtime.repositories.teamUsers.createTeamUser({ name: author.name, email: author.email, slackId: "synthetic-author", team: "AX 1파트", role: "om" });
    await runtime.repositories.teamUsers.createTeamUser({ name: manager.name, email: manager.email, slackId: "synthetic-manager", team: "AX 1파트", role: "om" });
    await runtime.repositories.instructorNote.saveNote("Synthetic instructor", { displayName: "Synthetic instructor" });
    const created = await runtime.repositories.omRequests.createOmRequest({ team: "1파트", ld: author.name, company: "Synthetic request company", trainingType: "오프라인", courseId: "SYN-REQUEST-PAGE", courseName: "Synthetic request course", courseCategory: "Synthetic category", instructorName: "Synthetic instructor", syncupLink: "https://example.invalid/syncup", driveLink: "https://example.invalid/drive", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "Y", coachRequest: "N", resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-06-02", timeStart: "10:00", timeEnd: "11:00", duration: "1", location: "Synthetic room" }], notes: "Synthetic request note" });
    const request = await runtime.repositories.omRequests.setOmRequestSlackMeta(created.id, { ldEmail: author.email }); assert.ok(request);
    const before = await snapshot(store); writes.length = 0;
    const raw = JSON.stringify(before); for (const secret of [author.email, author.name, manager.email, manager.name, "Synthetic instructor", "https://example.invalid/syncup", "https://example.invalid/drive", "Synthetic room", "Synthetic request note"]) assert.equal(raw.includes(secret), false);
    actor = author;
    const rendered = { entry: await requestPage(), manage: await managePage(), detail: await detailPage({ params: Promise.resolve({ id: created.id }) }), edit: await editPage({ params: Promise.resolve({ id: created.id }) }), complete: await completePage({ searchParams: Promise.resolve({ id: created.id }) }) };
    const entryForm = findElement(rendered.entry, "OmRequestForm"); assert.ok(entryForm); assert.deepEqual(props(entryForm).extraTools, ["Synthetic custom tool"]); assert.equal(props(entryForm).defaultTeam, "AX 1파트"); assert.deepEqual(props(entryForm).knownCompanies, ["Synthetic known company"]); assert.deepEqual(props(entryForm).knownInstructors, ["Synthetic instructor"]);
    const table = findElement(rendered.manage, "OmRequestTable"); assert.ok(table); assert.equal((props(table).initialRequests as unknown[]).length, 1);
    const assign = findElement(rendered.detail, "AssignForm"); assert.ok(assign); assert.equal(props(assign).canAssign, false); assert.equal((props(assign).request as { id: string }).id, created.id); assert.deepEqual(new Set(props(assign).omRoster as string[]), new Set([author.name, manager.name]));
    const actions = findElement(rendered.detail, "RequestActions"); assert.ok(actions); assert.equal(props(actions).isAdmin, false); assert.equal(props(actions).isAuthor, true);
    const editForm = findElement(rendered.edit, "OmRequestForm"); assert.ok(editForm); assert.equal(props(editForm).requestId, created.id); assert.equal((props(editForm).initialData as { company: string }).company, "Synthetic request company"); assert.deepEqual(props(editForm).knownInstructors, ["Synthetic instructor"]);
    assert.equal(hasPropValue(rendered.complete, "value", "Synthetic request course"), true); assert.equal(hasText(rendered.complete, "Synthetic request note"), true);
    actor = manager; const managerDetail = await detailPage({ params: Promise.resolve({ id: created.id }) }); const managerAssign = findElement(managerDetail, "AssignForm"); assert.ok(managerAssign); assert.equal(props(managerAssign).canAssign, true); const managerActions = findElement(managerDetail, "RequestActions"); assert.ok(managerActions); assert.equal(props(managerActions).isAdmin, false); assert.equal(props(managerActions).isAuthor, false);
    actor = admin; const adminDetail = await detailPage({ params: Promise.resolve({ id: created.id }) }); const adminActions = findElement(adminDetail, "RequestActions"); assert.ok(adminActions); assert.equal(props(adminActions).isAdmin, true); assert.equal(props(adminActions).isAuthor, false); const adminEdit = await editPage({ params: Promise.resolve({ id: created.id }) }); assert.ok(findElement(adminEdit, "OmRequestForm"));
    actor = outsider; await assert.rejects(editPage({ params: Promise.resolve({ id: created.id }) }), /NEXT_REDIRECT/);
    actor = null; process.env.OM_REQUEST_PAGES_BACKEND = "invalid"; await assert.rejects(completePage({ searchParams: Promise.resolve({ id: created.id }) }), /NEXT_REDIRECT/); process.env.OM_REQUEST_PAGES_BACKEND = "mongodb-shadow";
    actor = author;
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(store), before); assert.equal(pgAdapterCalls, 0); assert.equal(pgPoolCalls, 0);
    await assert.rejects(runtime.run(async () => (await import("./dataRepositoryContext")).getDataRepositoryOverride("requestActivity")), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
    const partialNamespace = `shadow_om_request_pages_partial_${randomBytes(6).toString("hex")}`, partial = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partial.db.createCollection(`${partialNamespace}_LegacyOnly`); await partial.db.collection(`${partialNamespace}_LegacyOnly`).insertOne({ marker: "unchanged" }); const partialBefore = await snapshot(partial); writes.length = 0;
    process.env.MONGODB_SHADOW_NAMESPACE = partialNamespace; await assert.rejects(requestPage(), /OM_REQUEST_PAGES_COMPOSITION_FAILED/); assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(partial), partialBefore);
  } finally { try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
