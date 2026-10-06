import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MongoClient } from "mongodb";
import ts from "typescript";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { MongoOperationStore } from "./mongoOperationStore";
import { MONGO_OPERATION_PAGES_RUNTIME_MODELS, prepareMongoOperationPagesRuntime } from "./mongoOperationPagesRuntime";
import type { CreateOperationInput } from "./operationTypes";

const uri = process.env.MONGODB_OPERATION_PAGES_COMPOSITION_TEST_URI;
let pgCalls = 0;
let localReads = 0;
mock.module("@/auth", { namedExports: { auth: async () => ({ user: { email: "synthetic@example.invalid", name: "Synthetic operator" }, expires: "" }) } });
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("PG_FORBIDDEN"); } } });
mock.module("@/lib/data/localJsonOperationRepository", { namedExports: { LocalJsonOperationRepository: class { async listOperations() { localReads++; return []; } } } });
mock.module("@/lib/data/operationCollaboration", { namedExports: { readOperationCollaboration: async () => ({ discussionReferences: [], issues: [], status: "disabled" }) } });
mock.module("@/lib/data/omRequest/omCustomToolsLocalRepository", { namedExports: { addCustomTools: () => {}, getOmCustomToolsRepository: () => ({ list: () => ["Synthetic tool"], add: () => {} }), listCustomTools: () => ["Synthetic tool"] } });
const hooks = registerHooks({ resolve(specifier, context, next) { if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null}", shortCircuit: true }; return next(["next/server", "next/navigation"].includes(specifier) ? `${specifier}.js` : specifier, context); }, load(url, context, next) { if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true }; return next(url, context); } });
const [{ default: listPage }, { default: detailPage }, { default: newPage }] = await Promise.all([import("../../app/operations/page"), import("../../app/operations/[operationId]/page"), import("../../app/operations/new/page")]);
hooks.deregister();

function input(): CreateOperationInput { return { archiveStatus: "아카이빙전", coach: "Synthetic coach", companyName: "Synthetic company", companyWikiLink: "", costRaw: "", courseId: "SYN-COMP", courseName: "Synthetic composition course", createdBy: "synthetic@example.invalid", driveLink: "", educationDays: "1", educationDates: ["2099-03-04"], educationFormat: "오프라인", endDate: "2099-03-04", instructorCost: null, instructorWikiLink: "", instructors: "Synthetic instructor", ld: "", lectureManagementLink: "", om: "Synthetic operator", onsiteRequired: "N", operationCost: null, operationDetail: "", operationIssue: "", operationStatus: "배정필요", operationType: "단기", padletLink: "", region: "", resultReportLink: "", revenue: null, roundNo: "1", specialNotes: "", startDate: "2099-03-04", timeText: "09:00-10:00", totalCost: null }; }
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement<Record<string, unknown>>(node)) return []; return [node, ...elements(node.props.children as ReactNode)]; }
function component(node: ReactNode, name: string) { const found = elements(node).find(element => typeof element.type === "function" && element.type.name === name); assert.ok(found); return found; }
async function snapshot(client: MongoClient, databaseName: string) { const output: Record<string, unknown> = {}; for (const info of (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray()).sort((a,b) => a.name.localeCompare(b.name))) { const collection = client.db(databaseName).collection(info.name); output[info.name] = { info, indexes: await collection.listIndexes().toArray(), rows: await collection.find({}).sort({ _id: 1 }).toArray() }; } return output; }

test("operation pages use prepared Mongo composition without writes or PostgreSQL fallback", { skip: !uri, timeout: 180_000 }, async () => {
  const target = new URL(uri!); assert.equal(target.hostname, "127.0.0.1"); assert.ok(target.port);
  const databaseName = `hub_om_shadow_operation_pages_comp_${randomBytes(6).toString("hex")}`, namespace = `shadow_operation_pages_${randomBytes(6).toString("hex")}`;
  const environment = { OPERATION_PAGES_BACKEND: "mongodb-shadow", MONGODB_URI: uri!, MONGODB_SHADOW_DATABASE: databaseName, MONGODB_SHADOW_NAMESPACE: namespace, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", DATABASE_URL: "postgresql://synthetic@127.0.0.1:1/forbidden", OPERATION_DATA_SOURCE: "postgres", DEV_AUTH_BYPASS: "true", DEV_AUTH_EMAIL: "synthetic@example.invalid", ADMIN_EMAILS: "synthetic@example.invalid" };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]])); Object.assign(process.env, environment);
  const client = new MongoClient(uri!, { directConnection: true });
  try {
    await client.connect(); const customTools = { list: () => ["Synthetic tool"], add: () => {} }; const options = { client, databaseName, namespace, allowShadowWrites: true as const, processSequenceHighWater: 0, omCustomTools: customTools };
    const runtime = await prepareMongoOperationPagesRuntime(options), store = new MongoOperationStore(options, MONGO_OPERATION_PAGES_RUNTIME_MODELS);
    const operation = await runtime.repositories.operations.createOperation(input());
    await runtime.repositories.teamUsers.createTeamUser({ name: "Synthetic operator", email: "synthetic@example.invalid", slackId: "SYNTHETIC", team: "1팀", role: "om" });
    await runtime.repositories.instructorNote.saveNote("Synthetic instructor", { displayName: "Synthetic instructor" });
    const omRequest = await runtime.repositories.omRequests.createOmRequest({ team: "1팀", ld: "", company: "Synthetic request company", trainingType: "오프라인", courseId: "SYN-REQUEST", courseName: "Synthetic request course", courseCategory: "Synthetic category", instructorName: "Synthetic request instructor", syncupLink: "https://example.invalid/syncup", driveLink: "https://example.invalid/drive", skillfloSetup: "N", skillmatchSetup: "N", onSiteOperation: "Y", coachRequest: "N", resultReportNeeded: "N", totalSessions: 1, sessions: [{ date: "2099-04-05", dateEnd: "2099-04-06", timeStart: "10:00", timeEnd: "11:00", duration: "1", location: "Synthetic request location" }], notes: "" });
    const coach = coachFixtureRow("Coach", { name: "Synthetic coach", normalizedName: "syntheticcoach", sourceCoachId: "synthetic-operation-page-coach", status: "ACTIVE", isActive: true, displayOrder: 0, accessToken: "synthetic-token", deletedAt: null }); await store.collection("Coach").insertOne(encodeMongoRuntimeDocument("Coach", coach));
    const before = await snapshot(client, databaseName);
    const list = await listPage({ searchParams: Promise.resolve({}) }); const detail = await detailPage({ params: Promise.resolve({ operationId: operation.operationId }), searchParams: Promise.resolve({}) }); const create = await newPage({ searchParams: Promise.resolve({ fromRequestId: omRequest.id }) });
    assert.equal((list.props as { operations: unknown[] }).operations.length, 1); assert.deepEqual(component(detail, "OperationDetail").props.coachOptions, ["Synthetic coach"]); assert.deepEqual(component(detail, "OperationDetail").props.extraTools, ["Synthetic tool"]); assert.ok(component(create, "OperationCreateForm").props.initialValues); await assert.rejects(detailPage({ params: Promise.resolve({ operationId: "excel-missing" }), searchParams: Promise.resolve({}) }), error => String((error as { digest?: unknown }).digest).includes("NEXT_HTTP_ERROR_FALLBACK;404")); assert.equal(localReads, 0); assert.deepEqual(await snapshot(client, databaseName), before); assert.equal(pgCalls, 0);
    const partial = `shadow_operation_pages_partial_${randomBytes(6).toString("hex")}`; process.env.MONGODB_SHADOW_NAMESPACE = partial; const legacy = client.db(databaseName).collection(`${partial}_LegacyOnly`); await client.db(databaseName).createCollection(legacy.collectionName, { validator: { marker: { $type: "string" } }, validationLevel: "strict", validationAction: "error" }); await legacy.insertOne({ marker: "unchanged" }); const partialBefore = await snapshot(client, databaseName); await assert.rejects(listPage({ searchParams: Promise.resolve({}) }), /OPERATION_PAGES_COMPOSITION_FAILED/); assert.deepEqual(await snapshot(client, databaseName), partialBefore); assert.equal(pgCalls, 0);
  } finally { try { await client.db(databaseName).dropDatabase(); } catch {} await client.close(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
