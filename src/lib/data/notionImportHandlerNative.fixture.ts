/** Parent-run synthetic fixture. Does not import or modify Sheets fixtures. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { BSON, type MongoClient } from "mongodb";
import { mock } from "node:test";
import { readNotionDatabaseImport } from "./notionImport";
import { MongoImportRepository, IMPORT_MODELS, prepareMongoImportStore } from "./mongoImportRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoOperationStore, completeMongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const URI = "mongodb://127.0.0.1:27852/?replicaSet=notionimport20260930";
export const DBPATH = "/private/tmp/hub-om-notion-import-20260930/mongo";
export const ROUTE = "/api/admin/imports/notion/import";
export const TOKEN = "synthetic-notion-shared-server-token";
export const PRIVATE = "notion-handler-synthetic-private";
export const CANARY = "notion-error-only-canary@example.invalid";
export const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
export const CONFIG_KEYS = ["NOTION_TOKEN", "NOTION_API_KEY", "NOTION_TEAM1_RESOURCE_DATABASE_ID", "NOTION_TEAM1_RESOURCE_URL",
  "NOTION_TEAM2_RESOURCE_DATABASE_ID", "NOTION_TEAM2_RESOURCE_URL", "NOTION_IMPORT_DATABASE_ID", "NOTION_IMPORT_DATABASE_URL"];
export const ERR = {
  generic: "Notion 데이터를 가져오지 못했습니다.", id: "Notion 데이터베이스 URL 또는 ID를 확인해 주세요.",
  permission: "Notion 통합 토큰 권한이 없습니다. 해당 데이터베이스에 Notion 통합을 초대했는지 확인해 주세요.",
  token: "서버에 NOTION_TOKEN 설정이 필요합니다.", url: "Notion 데이터베이스 URL을 입력하거나 담당 팀을 선택해 주세요.",
  empty: "저장할 Notion 행이 없습니다."
};
export type Actor = { user: { email: string; name: string }; expires: string; googleAccessToken?: string };
export const actor = (suffix = "a"): Actor => ({ user: { email: `Notion-${suffix}@day1company.co.kr`, name: `${PRIVATE}-${suffix}-${"이".repeat(210)}` }, expires: "", googleAccessToken: "synthetic-google-token-not-notion" });
export type Frame = { payload?: unknown; status?: number; statusText?: string; malformedJSON?: boolean; reject?: { value: unknown } };
export interface Probe {
  session: Actor | null; events: string[]; sourceCalls: Array<{ suffix: string; databaseUrlOrId: string; token: string }>;
  httpCalls: Array<{ url: string; init: RequestInit | undefined }>;
  databaseId: string; expectedToken: string; frames: Frame[];
  sourceFault?: { value: unknown }; countOverride?: number;
  sourceEntered?: () => void; sourceWait?: Promise<void>;
  auditEntered?: () => void; auditWait?: Promise<void>; auditFault?: { value: unknown };
}
export const probes = new AsyncLocalStorage<Probe>();
export function current() { const p = probes.getStore(); assert.ok(p); return p; }
export function page(suffix = "a", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  const text = (name: string) => ({ type: "rich_text", rich_text: [{ plain_text: name }] });
  return { id, url: `https://example.invalid/notion/${suffix}`, properties: {
    "기업명": text(`${PRIVATE}-company-${suffix}`), "과정명": text(`${PRIVATE}-course-${suffix}`),
    Date: { type: "date", date: { start: "2031-09-30", end: "2031-10-01" } },
    "운영": text(`${PRIVATE}-om-${suffix}`), "기획": text(`${PRIVATE}-ld-${suffix}`), "강사": text(`${PRIVATE}-instructor-${suffix}`)
  } };
}
export function probe(suffix = "a", session: Actor | null = actor(suffix)): Probe {
  return { session, events: [], sourceCalls: [], httpCalls: [], databaseId: IDS[suffix === "b" ? 1 : 0], expectedToken: TOKEN,
    frames: [{ payload: { results: [page(suffix)], has_more: false } }] };
}
export function body(label = "normal", databaseUrl = IDS[0]) {
  return { databaseUrl, sourceTeam: "team_1", sourceName: `${PRIVATE}-${label}`, token: "synthetic-body-token-not-notion" };
}
export function request(input: unknown, authorization = false, raw?: string) {
  return new Request(`https://example.invalid${ROUTE}`, { method: "POST", headers: { "content-type": "application/json",
    ...(authorization ? { authorization: "Bearer synthetic-header-token-not-notion" } : {}) }, body: raw ?? JSON.stringify(input) });
}
export function assertNoLeaks(value: unknown, secrets: readonly string[]) {
  const text = inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null });
  for (const secret of secrets) assert.ok(!text.includes(secret), "Forbidden canary detected");
}
export function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
export async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("NOTION_BARRIER_TIMEOUT")), 10_000); })]); }
  finally { clearTimeout(timer); }
}
export async function raw(store: MongoOperationStore, models: readonly string[] = ["DataImportRun", "OperationSourceRecord"]) {
  return BSON.EJSON.stringify(await Promise.all(models.map(async name => [name, await store.collection(name).find({}).sort({ _id: 1 }).toArray()])), { relaxed: false });
}
export async function setup(client: MongoClient, databaseName: string, suffix: string) {
  const options = { client, databaseName, namespace: `shadow_notion_handler_${suffix}`, allowShadowWrites: true as const };
  await prepareMongoImportStore(options); await prepareMongoReadStore(options, TEAM_READ_MODELS);
  await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS); await prepareMongoRequestAuditStore(options);
  const store = new MongoOperationStore(options, [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])]);
  const put = async (model: string, fields: Record<string, unknown>) => store.collection(model).insertOne(encodeMongoRuntimeDocument(model, completeMongoRow(model, fields)));
  const at = new Date("2030-01-01T00:00:00Z"), companyId = randomUUID(), courseId = randomUUID();
  // Existing fields.json does not classify Company.name/normalizedName or
  // Course.name as encrypted fields. These pre-request operational sentinels
  // must not reuse the PRIVATE canary for encrypted import/roster/audit data.
  // Keep the full raw leak scan unchanged; do not filter these models or fields.
  const operationalSentinel = "synthetic-operational-baseline-sentinel";
  await put("Company", { id: companyId, name: operationalSentinel, normalizedName: operationalSentinel, createdAt: at, updatedAt: at });
  await put("Course", { id: courseId, companyId, courseId: "SYNTHETIC-SENTINEL", name: operationalSentinel, operationType: "NEEDS_REVIEW", processSeq: 1, createdAt: at, updatedAt: at });
  await put("OperationSession", { id: randomUUID(), courseRecordId: courseId, operationId: "SYNTHETIC-SENTINEL", operationStatus: "ASSIGNMENT_NEEDED",
    archiveStatus: "NOT_READY", educationFormat: "NEEDS_REVIEW", operationChannel: "NEEDS_REVIEW", onsiteRequired: "UNKNOWN",
    hasSatisfactionSurvey: "NEEDS_REVIEW", hasResultReport: "NEEDS_REVIEW", startDate: at, endDate: at, educationDates: [], createdAt: at, updatedAt: at });
  for (const role of ["OM", "LD"]) await put("TeamUser", { id: randomUUID(), name: `${PRIVATE}-${role.toLowerCase()}-${suffix}`,
    email: `synthetic-${role}-${suffix}@example.invalid`, slackId: `synthetic-${role}-${suffix}`, team: "1팀", role, createdAt: at });
  await put("InstructorNote", { id: randomUUID(), instructorName: `${PRIVATE}-instructor-${suffix}`, displayName: `${PRIVATE}-instructor-${suffix}`,
    recruitAvoid: false, createdAt: at, updatedAt: at });
  const baselineCompany = await store.collection("Company").findOne({ _id: companyId });
  const baselineCourse = await store.collection("Course").findOne({ _id: courseId });
  assert.equal(baselineCompany?.name, operationalSentinel);
  assert.equal(baselineCompany?.normalizedName, operationalSentinel);
  assert.equal(baselineCourse?.name, operationalSentinel);
  // Fail at setup if a forbidden marker is already present before any handler.
  assertNoLeaks(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())), [PRIVATE, CANARY, TOKEN]);
  const imports = await MongoImportRepository.open(options), teamMembers = await MongoTeamMemberRepository.open(options),
    instructorNote = await MongoInstructorNoteRepository.open(options), requestActivity = await MongoRequestAuditRepository.open(options);
  const save = imports.storeParsedImport.bind(imports), members = teamMembers.listRoleRosters.bind(teamMembers),
    notes = instructorNote.listNotes.bind(instructorNote), audit = requestActivity.recordRequest.bind(requestActivity);
  const observers = [
    mock.method(imports, "storeParsedImport", async (input: Parameters<typeof save>[0]) => { current().events.push("store:start"); const result = await save(input); current().events.push("store:done"); return result; }),
    mock.method(teamMembers, "listRoleRosters", async () => { current().events.push("roster:members"); return members(); }),
    mock.method(instructorNote, "listNotes", async () => { current().events.push("roster:instructors"); return notes(); }),
    mock.method(requestActivity, "recordRequest", async (...args: Parameters<typeof audit>) => {
      const p = current(); p.events.push("audit:start"); p.auditEntered?.(); await p.auditWait;
      if (p.auditFault) throw p.auditFault.value;
      await audit(...args); p.events.push("audit:done");
    })
  ];
  const notionImportSource = { async readDatabase(input: { databaseUrlOrId: string; token: string }) {
    const p = current(); p.events.push("source:start"); p.sourceCalls.push({ suffix, ...input });
    p.sourceEntered?.(); await p.sourceWait; if (p.sourceFault) throw p.sourceFault.value;
    const result = await readNotionDatabaseImport(input); p.events.push("source:done");
    // Explicit contract-only count injection; actual parser and stored rows remain real.
    return p.countOverride === undefined ? result : { ...result, rowCount: p.countOverride };
  } };
  const protectedModels = ["Company", "Course", "OperationSession"];
  const sentinel = await raw(store, protectedModels);
  return { store, scope: { imports, teamMembers, instructorNote, requestActivity, notionImportSource },
    assertSentinel: async () => {
      assert.equal(await raw(store, protectedModels), sentinel);
      assert.equal(await store.collection("OperationSourceRecord").countDocuments({ operationSessionId: { $ne: null } }), 0);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    }, restore: () => { for (const observer of observers) observer.mock.restore(); } };
}
export type Native = Awaited<ReturnType<typeof setup>>;
export async function errorResponse(response: Response, error: string) { assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error }); }
export async function success(response: Response, rowCount = 1) {
  assert.equal(response.status, 200); const value = await response.json();
  assert.match(value.importRunId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.deepEqual(value, { ok: true, duplicateCount: 0, errorCount: 0, importRunId: value.importRunId, rowCount, storedCount: 1 });
  return value.importRunId as string;
}
export async function checkAudit(native: Native, id: string | null, status: number, p: Probe, authorization = false) {
  assert.ok(id); const row = await native.store.one("ActivityRequest", { _id: id }); assert.ok(row);
  const allowed = p.session?.user.email.toLowerCase().endsWith("@day1company.co.kr");
  assert.deepEqual({ id: row.id, actorType: row.actorType, actorEmail: row.actorEmail, actorName: row.actorName, route: row.route, method: row.method, status: row.status }, {
    id, actorType: authorization ? "token_request" : allowed ? "user" : "anonymous",
    actorEmail: !authorization && allowed ? p.session!.user.email.toLowerCase() : null,
    actorName: !authorization && allowed ? p.session!.user.name.slice(0, 200) : null, route: ROUTE, method: "POST", status
  });
  assert.ok(Number.isInteger(row.durationMs) && Number(row.durationMs) >= 0);
  assert.equal(p.events.filter(event => event === "audit:start").length, 1); assert.equal(p.events.at(-1), "audit:done");
}
