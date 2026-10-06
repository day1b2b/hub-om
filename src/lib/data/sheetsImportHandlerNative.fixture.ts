/** Synthetic-only native composition. Parent owns execution and server lifecycle. */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BSON, type MongoClient } from "mongodb";
import { mock } from "node:test";
import { MongoImportRepository, IMPORT_MODELS, prepareMongoImportStore } from "./mongoImportRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { MongoOperationStore, completeMongoRow } from "./mongoOperationStore";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";

export const URI = "mongodb://127.0.0.1:27851/?replicaSet=sheetsimport20260930";
export const ROOT = "/private/tmp/hub-om-google-sheets-import-20260930";
export const PRIVATE = "sheets-handler-private-synthetic";
export const CANARY = "sheets-error-only-secret@example.invalid";
export const HEADERS = ["companyName", "courseName", "startDate", "endDate", "om", "ld", "instructors"];
export const TABS = [{ gid: 9, title: "합성 탭 아홉" }, { gid: 0, title: "합성 탭 영" }];
export type Actor = { user: { email: string; name: string }; expires: string; googleAccessToken?: string };
export const actor = (suffix = "a"): Actor => ({ user: { email: `Sheets-${suffix}@day1company.co.kr`, name: `${PRIVATE}-${suffix}-${"이".repeat(210)}` },
  expires: "", googleAccessToken: `synthetic-sheets-token-${suffix}` });
export interface Probe {
  session: Actor | null;
  events: string[];
  sourceCalls: unknown[][];
  rows?: string[][];
  fault?: { value: unknown };
  sourceEntered?: () => void;
  sourceWait?: Promise<void>;
  auditEntered?: () => void;
  auditWait?: Promise<void>;
  auditFault?: { value: unknown };
  transport?: { status: number; jsonFault?: boolean; calls: unknown[][] };
}
export const probes = new AsyncLocalStorage<Probe>();
export function probe(session: Actor | null = actor()): Probe { return { session, events: [], sourceCalls: [] }; }
export function current(): Probe { const value = probes.getStore(); assert.ok(value, "request probe required"); return value; }
export function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
export async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`BARRIER_TIMEOUT:${label}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
export function rows(suffix = "a", label = "normal"): string[][] {
  return [HEADERS, [`${PRIVATE}-company-${suffix}-${label}`, `${PRIVATE}-course-${suffix}-${label}`, "2031-09-30", "2031-10-01",
    `${PRIVATE}-om-${suffix}`, `${PRIVATE}-ld-${suffix}`, `${PRIVATE}-instructor-${suffix}`]];
}
export function body(label = "normal") {
  return { spreadsheetUrl: "https://docs.google.com/spreadsheets/d/synthetic-book/edit?gid=9", tabTitle: "  합성 탭  ",
    sourceName: `${PRIVATE}-${label}`, sourceTeam: "team_1", importYear: 2031 };
}
export type Endpoint = "tabs" | "import";
export const route = (endpoint: Endpoint) => `/api/admin/imports/google-sheets/${endpoint}`;
export function request(endpoint: Endpoint, input: unknown = body(), authorization = false, raw?: string) {
  return new Request(`https://example.invalid${route(endpoint)}`, { method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization: "Bearer synthetic-header-not-google-token" } : {}) },
    body: raw ?? JSON.stringify(input) });
}
export const ERRORS = {
  url: "Google 스프레드시트 URL을 확인해 주세요.",
  permission: "스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요.",
  read: "Google 스프레드시트를 읽지 못했습니다.",
  header: "헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요.",
  tabs: "탭 목록을 불러오지 못했습니다.", import: "스프레드시트를 가져오지 못했습니다."
};
export async function setup(client: MongoClient, databaseName: string, suffix: string) {
  const options = { client, databaseName, namespace: `shadow_sheets_handler_${suffix}`, allowShadowWrites: true as const };
  await prepareMongoImportStore(options);
  await prepareMongoReadStore(options, TEAM_READ_MODELS);
  await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
  await prepareMongoRequestAuditStore(options);
  const models = [...new Set([...IMPORT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])];
  const store = new MongoOperationStore(options, models);
  for (const role of ["OM", "LD"] as const) {
    await store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", completeMongoRow("TeamUser", {
      id: randomUUID(), name: `${PRIVATE}-${role.toLowerCase()}-${suffix}`, email: `synthetic-${role}-${suffix}@example.invalid`,
      slackId: `synthetic-${role}-${suffix}`, team: "1팀", role, createdAt: new Date()
    })));
  }
  await store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", completeMongoRow("InstructorNote", {
    id: randomUUID(), instructorName: `${PRIVATE}-instructor-${suffix}`, displayName: `${PRIVATE}-instructor-${suffix}`,
    recruitAvoid: false, createdAt: new Date(), updatedAt: new Date()
  })));
  const imports = await MongoImportRepository.open(options);
  const teamMembers = await MongoTeamMemberRepository.open(options);
  const instructorNote = await MongoInstructorNoteRepository.open(options);
  const requestActivity = await MongoRequestAuditRepository.open(options);
  // Call-through observers retain actual repository implementations. Audit faults
  // are a separately labelled injection lane, never evidence of native failure.
  const save = imports.storeParsedImport.bind(imports);
  const roster = teamMembers.listRoleRosters.bind(teamMembers);
  const notes = instructorNote.listNotes.bind(instructorNote);
  const audit = requestActivity.recordRequest.bind(requestActivity);
  const observers = [
    mock.method(imports, "storeParsedImport", async (input: Parameters<typeof save>[0]) => {
      current().events.push("store:start"); const result = await save(input); current().events.push("store:done"); return result;
    }),
    mock.method(teamMembers, "listRoleRosters", async () => {
      current().events.push("roster:members"); return roster();
    }),
    mock.method(instructorNote, "listNotes", async () => {
      current().events.push("roster:instructors"); return notes();
    }),
    mock.method(requestActivity, "recordRequest", async (...args: Parameters<typeof audit>) => {
      const p = current(); p.events.push("audit:start"); p.auditEntered?.(); await p.auditWait;
      if (p.auditFault) throw p.auditFault.value;
      await audit(...args); p.events.push("audit:done");
    })
  ];
  async function source(method: "tabs" | "rows", args: string[]) {
    const p = current(); p.events.push(`source:${method}`); p.sourceCalls.push([suffix, method, ...args]);
    p.sourceEntered?.(); await p.sourceWait;
    if (p.fault) throw p.fault.value;
    p.events.push("source:done");
  }
  const googleSheetsImportSource = {
    async listTabs(accessToken: string, spreadsheetId: string) {
      await source("tabs", [accessToken, spreadsheetId]); return structuredClone(TABS);
    },
    async readRows(accessToken: string, spreadsheetId: string, tabTitle: string) {
      await source("rows", [accessToken, spreadsheetId, tabTitle]); return structuredClone(current().rows ?? rows(suffix));
    }
  };
  return { store, scope: { imports, teamMembers, instructorNote, requestActivity, googleSheetsImportSource },
    restore: () => { for (const observer of observers) observer.mock.restore(); } };
}
export type Native = Awaited<ReturnType<typeof setup>>;
export async function snapshot(store: MongoOperationStore) {
  // Request audit is separate best-effort work, not part of staging rollback.
  const names = store.models.filter(name => name !== "ActivityRequest").sort();
  return BSON.EJSON.stringify(await Promise.all(names.map(async name => [name,
    await store.collection(name).find({}).sort({ _id: 1 }).toArray()])), { relaxed: false });
}
export async function errorResponse(response: Response, text: string, status = 400) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: text });
}
export async function success(response: Response, endpoint: Endpoint) {
  assert.equal(response.status, 200);
  const value = await response.json();
  if (endpoint === "tabs") {
    assert.deepEqual(value, { ok: true, selectedGid: 9, spreadsheetId: "synthetic-book", tabs: TABS });
    return null;
  }
  assert.match(value.importRunId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.deepEqual(value, { ok: true, duplicateCount: 0, errorCount: 0, headerRowNumber: 1,
    importRunId: value.importRunId, rowCount: 1, storedCount: 1 });
  return value.importRunId as string;
}
export async function checkAudit(store: MongoOperationStore, id: string | null, endpoint: Endpoint, status: number,
  session: Actor | null, authorization = false) {
  assert.ok(id); const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row);
  const allowed = session?.user.email.endsWith("@day1company.co.kr");
  assert.deepEqual({ id: row.id, actorType: row.actorType, actorEmail: row.actorEmail, actorName: row.actorName,
    route: row.route, method: row.method, status: row.status }, {
    id, actorType: authorization ? "token_request" : allowed ? "user" : "anonymous",
    actorEmail: !authorization && allowed ? session!.user.email.toLowerCase() : null,
    actorName: !authorization && allowed ? session!.user.name.slice(0, 200) : null,
    route: route(endpoint), method: "POST", status
  });
  assert.ok(Number.isInteger(row.durationMs) && Number(row.durationMs) >= 0);
  assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: id }), 0);
}
