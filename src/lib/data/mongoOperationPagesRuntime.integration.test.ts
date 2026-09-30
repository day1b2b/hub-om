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
import { MONGO_OPERATION_PAGES_RUNTIME_MODELS, openMongoOperationPagesRuntime, prepareMongoOperationPagesRuntime } from "./mongoOperationPagesRuntime";
import type { CreateOperationInput } from "./operationTypes";

const uri = process.env.MONGODB_OPERATION_PAGES_TEST_URI;
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "synthetic@example.invalid", name: "Synthetic operator" }, expires: "" }) } });
mock.module("@/lib/data/operationCollaboration", { namedExports: { readOperationCollaboration: async () => ({ discussionReferences: [], issues: [], status: "disabled" }) } });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
    return next(specifier === "next/navigation" || specifier === "next/server" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) { if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }; return next(url, context); }
});
const [{ default: listPage }, { default: detailPage }, { default: newPage }] = await Promise.all([
  import("../../app/operations/page"), import("../../app/operations/[operationId]/page"), import("../../app/operations/new/page")
]);
hooks.deregister();

function operationInput(): CreateOperationInput { return { archiveStatus: "아카이빙전", coach: "Synthetic coach", companyName: "Synthetic company", companyWikiLink: "", costRaw: "", courseId: "SYN-RUNTIME", courseName: "Synthetic runtime course", createdBy: "synthetic@example.invalid", driveLink: "", educationDays: "1", educationDates: ["2099-03-04"], educationFormat: "오프라인", endDate: "2099-03-04", instructorCost: null, instructorWikiLink: "", instructors: "Synthetic instructor", ld: "", lectureManagementLink: "", om: "Synthetic operator", onsiteRequired: "N", operationCost: null, operationDetail: "", operationIssue: "", operationStatus: "배정필요", operationType: "단기", padletLink: "", region: "", resultReportLink: "", revenue: null, roundNo: "1", specialNotes: "", startDate: "2099-03-04", timeText: "09:00-10:00", totalCost: null }; }
function props(element: ReactElement) { return element.props as Record<string, unknown>; }
function findElement(value: unknown, name: string): ReactElement | undefined {
  if (!value || typeof value !== "object") return undefined;
  const element = value as ReactElement; const type = element.type as { name?: string } | string;
  if ((typeof type === "string" ? type : type?.name) === name) return element;
  const children = (element.props as { children?: unknown }).children;
  for (const child of Array.isArray(children) ? children : [children]) { const found = findElement(child, name); if (found) return found; }
  return undefined;
}
async function snapshot(store: MongoOperationStore) { const rows: Record<string, unknown> = {}; for (const item of (await store.db.listCollections({}, { nameOnly: true }).toArray()).sort((a, b) => a.name.localeCompare(b.name))) rows[item.name] = await store.db.collection(item.name).find({}).sort({ _id: 1 }).toArray(); return rows; }

test("operation list/detail/new pages use one native Mongo scope without writes or PostgreSQL fallback", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port); assert.equal(target.username, ""); assert.equal(target.password, "");
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "DEV_AUTH_BYPASS", "DEV_AUTH_EMAIL", "ADMIN_EMAILS", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "SLACK_BOT_TOKEN", "SLACK_DISCUSSION_CHANNEL_IDS", "EMAIL_DISCUSSION_ARCHIVE_PATH"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "true", DEV_AUTH_EMAIL: "synthetic@example.invalid", ADMIN_EMAILS: "synthetic@example.invalid", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  delete process.env.SLACK_BOT_TOKEN; delete process.env.SLACK_DISCUSSION_CHANNEL_IDS; delete process.env.EMAIL_DISCUSSION_ARCHIVE_PATH;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
  const writes: CommandStartedEvent[] = [];
  const mutating = new Set(["create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes", "findAndModify", "bulkWrite", "renameCollection"]);
  client.on("commandStarted", event => {
    const output = event.commandName === "aggregate" && Array.isArray(event.command.pipeline) && event.command.pipeline.some((stage: unknown) => stage && typeof stage === "object" && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")));
    if (mutating.has(event.commandName) || output) writes.push(event);
  });
  const databaseName = `hub_om_shadow_operation_pages_${randomBytes(12).toString("hex")}`, namespace = `shadow_operation_pages_${randomBytes(8).toString("hex")}`;
  const customTools = Object.freeze({ list: () => ["Synthetic tool"], add: () => { throw new Error("UNEXPECTED_TOOL_WRITE"); } });
  try {
    await client.connect(); const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0, omCustomTools: customTools };
    const runtime = await prepareMongoOperationPagesRuntime(options);
    const readyStore = new MongoOperationStore(options, MONGO_OPERATION_PAGES_RUNTIME_MODELS), ready = await snapshot(readyStore);
    writes.length = 0;
    await prepareMongoOperationPagesRuntime(options); await openMongoOperationPagesRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []); assert.deepEqual(await snapshot(readyStore), ready);
    const second = await prepareMongoOperationPagesRuntime({ ...options, namespace: `shadow_operation_pages_second_${randomBytes(6).toString("hex")}` });
    let nested = 0;
    assert.throws(() => runtime.run(() => second.run(() => { nested++; })), /CALENDAR_SCOPE_MISMATCH/); assert.equal(nested, 0);
    for (const key of Object.keys(runtime.repositories) as Array<keyof typeof runtime.repositories>) {
      const partial: Partial<typeof runtime.repositories> = { ...runtime.repositories }; delete partial[key];
      assert.throws(() => runWithDataRepositories(partial, () => { nested++; }), /CALENDAR_SCOPE_MISMATCH/);
    }
    assert.equal(nested, 0);
    const operation = await runtime.repositories.operations.createOperation(operationInput());
    await runtime.repositories.teamUsers.createTeamUser({ name: "Synthetic operator", email: "synthetic@example.invalid", slackId: "SYNTHETIC", team: "1팀", role: "om" });
    await runtime.repositories.instructorNote.saveNote("Synthetic instructor", { displayName: "Synthetic instructor" });
    const request = await runtime.repositories.omRequests.createOmRequest({ team: "1팀", ld: "", company: "Synthetic request company", trainingType: "오프라인", courseId: "SYN-REQUEST", courseName: "Synthetic request course", courseCategory: "Synthetic category", instructorName: "Synthetic request instructor", syncupLink: "https://example.invalid/syncup", driveLink: "https://example.invalid/drive", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "Y", coachRequest: "N", resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-04-05", dateEnd: "2099-04-06", timeStart: "10:00", timeEnd: "11:00", duration: "1", location: "Synthetic request location" }], notes: "" });
    const coach = coachFixtureRow("Coach", { name: "Synthetic coach", normalizedName: "syntheticcoach", sourceCoachId: "synthetic-operation-page-coach", status: "ACTIVE", isActive: true, displayOrder: 0, accessToken: "synthetic-token", deletedAt: null });
    const store = new MongoOperationStore(options); const coachStore = new MongoOperationStore(options, ["Coach"]);
    await coachStore.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coach));
    const before = await snapshot(store);
    const rendered = await runtime.run(async () => {
      const list = await listPage({ searchParams: Promise.resolve({}) });
      const detail = await detailPage({ params: Promise.resolve({ operationId: operation.operationId }), searchParams: Promise.resolve({}) });
      const create = await newPage({ searchParams: Promise.resolve({ fromRequestId: request.id }) });
      return { list, detail, create };
    });
    assert.equal((props(rendered.list).operations as unknown[]).length, 1);
    assert.deepEqual(props(rendered.detail).coachOptions, ["Synthetic coach"]); assert.deepEqual(props(rendered.detail).instructorOptions, ["Synthetic instructor"]); assert.deepEqual(props(rendered.detail).extraTools, ["Synthetic tool"]);
    const form = findElement(rendered.create, "OperationCreateForm"); assert.ok(form); assert.deepEqual(props(form).personOptions, { ld: [], om: ["Synthetic operator"] });
    assert.deepEqual(props(form).initialValues, { companyName: "Synthetic request company", courseId: "SYN-REQUEST", courseName: "Synthetic request course", driveLink: "https://example.invalid/drive", educationDays: "1", endDate: "2099-04-06", instructors: "Synthetic request instructor", onsiteRequired: "Y", operationDetail: "https://example.invalid/syncup", region: "Synthetic request location", startDate: "2099-04-05", timeText: "10:00 ~ 11:00", trainingType: "오프라인" });
    assert.deepEqual(await snapshot(store), before);
    await assert.rejects(runtime.run(async () => (await import("./dataRepositoryContext")).getDataRepositoryOverride("requestActivity")), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
    const partialNamespace = `shadow_operation_pages_partial_${randomBytes(6).toString("hex")}`;
    const partialStore = new MongoOperationStore({ ...options, namespace: partialNamespace });
    await partialStore.db.createCollection(`${partialNamespace}_OperationSession`);
    await partialStore.db.collection<{ _id: string; value: string }>(`${partialNamespace}_OperationSession`).insertOne({ _id: "partial-marker", value: "unchanged" });
    const partialBefore = await snapshot(partialStore);
    writes.length = 0;
    await assert.rejects(prepareMongoOperationPagesRuntime({ ...options, namespace: partialNamespace }), /MONGO_OPERATION_PAGES_RUNTIME_FAILED/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.deepEqual(await snapshot(partialStore), partialBefore);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch {} await client.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
