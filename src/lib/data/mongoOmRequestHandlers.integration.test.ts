/** Native disposable Mongo replica set; execution evidence lives in mongodb-om-requests.
 * Actual routes/server-page functions, auth guards, facades, audit and repositories.
 * Only session supply and UI leaves are replaced; PG/fetch/local-file mocks are tripwires.
 * Synthetic custom-tool/notifier ports are explicit scope inputs, not service mocks.
 * Server React trees/props are checked, NOT browser rendering/interactions/proxy auth.
 * Assignment is deliberately unsupported in this first CRUD + intake unit.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MongoClient, type Document } from "mongodb";
import ts from "typescript";
import type { OmRequest, OmRequestInput } from "./omRequest/omRequestTypes";
import type { notifyOmRequestCreated } from "../slack/notifySlack";

type Session = { user: { email: string; name: string }; expires: string };
type Notification = Parameters<typeof notifyOmRequestCreated>[0];
const actors = new AsyncLocalStorage<Session | null>();
const author: Session = { user: { email: "synthetic-author@day1company.co.kr", name: "Synthetic private LD" }, expires: "" };
const admin: Session = { user: { email: "synthetic-admin@day1company.co.kr", name: "Synthetic admin" }, expires: "" };
const other: Session = { user: { email: "synthetic-other@day1company.co.kr", name: "Synthetic other" }, expires: "" };
const manager: Session = { user: { email: "synthetic-manager@day1company.co.kr", name: "Display name is not authority" }, expires: "" };
const PRIVATE_ERROR = "synthetic-private-failure@example.invalid";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (method: string, body?: unknown) => new Request("https://example.invalid/api/om-request", {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
});
function input(label: string = randomUUID()): OmRequestInput {
  return {
    team: "1파트", ld: author.user.name, company: `Synthetic company ${label}`, businessNumber: "SYNTHETIC-PRIVATE-BUSINESS",
    trainingType: "해커톤", courseId: `SYN-${label}`, courseName: `Synthetic course ${label}`,
    courseCategoryMajor: "Synthetic major", courseCategory: "Synthetic category", tools: "Synthetic custom tool",
    instructorName: "Synthetic private instructor", syncupLink: "https://example.invalid/private-syncup",
    driveLink: "https://example.invalid/private-drive", skillfloSetup: "Y", skillmatchSetup: "N", onSiteOperation: "Y",
    coachRequest: "N", resultReportNeeded: "N", totalSessions: 2,
    sessions: [
      { date: "2099-10-01", dateEnd: "2099-10-03", educationDatesText: "2099-10-01, 2099-10-03", timeStart: "09:00", timeEnd: "18:00", duration: "8", location: "Synthetic private room one" },
      { date: "2099-10-05", timeStart: "10:00", timeEnd: "12:00", duration: "2", location: "Synthetic private room two" }
    ], notes: "Synthetic private notes"
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function component(node: ReactNode, name: string) {
  const matches = elements(node).filter(element => typeof element.type === "function" && element.type.name === name);
  assert.equal(matches.length, 1, `Expected one ${name}`); return matches[0];
}
function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<Record<string, unknown>>(node)) return textOf(node.props.children as ReactNode);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
async function expectJson(response: Response, status: number, expected: unknown) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), expected);
}

const uri = process.env.MONGODB_OM_REQUEST_TEST_URI;
test("OM request actual handlers/server pages: native CRUD + intake, scoped assignment closed", { skip: !uri, timeout: 240_000 }, async suite => {
  // Validate before importing product code or opening any connection. No inferred/env-file target.
  const target = new URL(uri!);
  assert.equal(target.protocol, "mongodb:"); assert.equal(target.hostname, "127.0.0.1");
  assert.match(target.port, /^\d+$/); assert.ok(Number(target.port) > 0);
  assert.equal(target.username, ""); assert.equal(target.password, ""); assert.equal(target.pathname, "/"); assert.equal(target.hash, "");
  for (const [key, value] of target.searchParams) {
    assert.ok(["replicaSet", "directConnection"].includes(key), `Unsupported URI option: ${key}`);
    assert.equal(target.searchParams.getAll(key).length, 1);
    if (key === "directConnection") assert.equal(value, "true");
    if (key === "replicaSet") assert.match(value, /^[A-Za-z0-9_-]+$/);
  }
  const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS",
    "DEV_AUTH_BYPASS", "DATABASE_URL", "OPERATION_DATA_SOURCE", "AUTH_SECRET", "NEXTAUTH_SECRET"].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    AUTH_SECRET: randomBytes(32).toString("base64"), OPERATION_DATA_SOURCE: "local"
  });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS; delete process.env.NEXTAUTH_SECRET;
  const databaseName = `hub_om_shadow_om_request_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const restores: Array<() => void> = [];
  let connected = false, pgCalls = 0, localCalls = 0;
  const logs: unknown[][] = [];
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external fetch"); });
  restores.push(() => external.mock.restore());
  const logger = mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
  restores.push(() => logger.mock.restore());
  const originalRead = fs.readFileSync;
  function localTripwire(value: unknown) {
    if (!(typeof value === "string" || value instanceof URL || Buffer.isBuffer(value))) return;
    const name = value instanceof URL ? fileURLToPath(value) : String(value);
    const normalized = path.resolve(name), base = path.basename(normalized);
    if (/^\.env(?:\.|$)/.test(base) || normalized.includes(`${path.sep}.local${path.sep}`)
      || normalized === path.join(process.cwd(), ".local")
      || /^(?:om-requests|om-custom-tools|team-users|team-members|operations|instructor-wiki)\.json(?:\..*)?$/.test(base)) {
      localCalls++; throw new Error("Unexpected original local data access");
    }
  }
  // Patch both default and named fs exports. Source/loader package files remain readable.
  for (const key of ["existsSync", "readFileSync", "writeFileSync", "openSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync"] as const) {
    const original = fs[key] as (...args: unknown[]) => unknown;
    const guard = mock.method(fs, key, ((...args: unknown[]) => {
      localTripwire(args[0]); if (key === "renameSync") localTripwire(args[1]); return Reflect.apply(original, fs, args);
    }) as typeof fs[typeof key]);
    restores.push(() => guard.mock.restore());
  }
  for (const key of ["readFile", "writeFile", "open", "mkdir", "rename", "unlink", "rm", "access"] as const) {
    const original = fsp[key] as (...args: unknown[]) => unknown;
    const guard = mock.method(fsp, key, ((...args: unknown[]) => {
      localTripwire(args[0]); if (key === "rename") localTripwire(args[1]); return Reflect.apply(original, fsp, args);
    }) as typeof fsp[typeof key]);
    restores.push(() => guard.mock.restore());
  }
  syncBuiltinESMExports();
  const sessionMock = mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
  restores.push(() => sessionMock.restore());
  const pgMock = mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG fallback"); } } });
  restores.push(() => pgMock.restore());
  class ForbiddenPool { constructor() { pgCalls++; throw new Error("Unexpected direct PG pool"); } }
  const poolMock = mock.module("pg", { namedExports: { Pool: ForbiddenPool }, defaultExport: { Pool: ForbiddenPool } });
  restores.push(() => poolMock.restore());
  const ui = new Set(["OmRequestForm", "OmRequestTable", "AssignForm", "RequestActions"]);
  const hooks = registerHooks({
    resolve(specifier, resolution, next) {
      const name = specifier.split("/").at(-1)!;
      if (specifier === "@/components/AppSidebar" || ui.has(name)) {
        const exportName = specifier === "@/components/AppSidebar" ? "AppSidebar" : name;
        return { url: `data:text/javascript,export function ${exportName}(){return null;}`, shortCircuit: true };
      }
      if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
      return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, resolution);
    },
    load(url, resolution, next) {
      if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(originalRead(fileURLToPath(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText, shortCircuit: true };
      return next(url, resolution);
    }
  });
  try {
    // Expected new module/keys are intentional compile-time integration gates, not casts to any.
    const { MongoOmRequestRepository, prepareMongoOmRequestStore, OM_REQUEST_MODELS } = await import("./mongoOmRequestRepository");
    const { MongoOperationRepository } = await import("./mongoOperationRepository");
    const { MongoOperationStore, completeMongoRow, prepareMongoOperationStore, operationMongoValidator, OPERATION_MODELS } = await import("./mongoOperationStore");
    const { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } = await import("./mongoRequestAuditRepository");
    const { MongoTeamUserRepository, prepareMongoTeamUserStore } = await import("./teamUsers/mongoTeamUserRepository");
    const { MongoTeamMemberRepository } = await import("./mongoTeamMemberRepository");
    const { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } = await import("./mongoInstructorNoteRepository");
    const { prepareMongoReadStore, TEAM_READ_MODELS } = await import("./mongoReadStore");
    const { encodeMongoRuntimeDocument, MongoJsonNull } = await import("./mongoRuntimeCodec");
    const { runWithDataRepositories } = await import("./dataRepositoryContext");
    const { omRequestManagerName } = await import("./omRequest/omRequestTypes");
    const collectionRoute = await import("../../app/api/om-request/route");
    const itemRoute = await import("../../app/api/om-request/[id]/route");
    const assignmentRoute = await import("../../app/api/om-request/assign/route");
    const { default: newPage } = await import("../../app/om-request/page");
    const { default: listPage } = await import("../../app/om-request/manage/page");
    const { default: detailPage } = await import("../../app/om-request/manage/[id]/page");
    const { default: editPage } = await import("../../app/om-request/manage/[id]/edit/page");
    const { default: completePage } = await import("../../app/om-request/complete/page");
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_handlers", allowShadowWrites: true as const };
    await prepareMongoOperationStore({ ...options, processSequenceHighWater: 0 });
    await prepareMongoOmRequestStore(options); await prepareMongoRequestAuditStore(options);
    await prepareMongoTeamUserStore(options); await prepareMongoReadStore(options, TEAM_READ_MODELS);
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
    const store = new MongoOperationStore(options, [...new Set([...OM_REQUEST_MODELS, ...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS, ...TEAM_READ_MODELS, ...INSTRUCTOR_NOTE_MODELS])]);
    const repo = await MongoOmRequestRepository.open(options);
    const tools: string[] = ["Synthetic known tool"], added: string[][] = [], notifications: Notification[] = [];
    let failTools = false, failNotifier = false, nullNotification = false, toolReads = 0;
    const scope = {
      omRequests: repo, operations: await MongoOperationRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options),
      teamUsers: await MongoTeamUserRepository.open(options), teamMembers: await MongoTeamMemberRepository.open(options),
      instructorNote: await MongoInstructorNoteRepository.open(options),
      omCustomTools: { list(): string[] { toolReads++; return [...tools]; }, add(names: string[]): void {
        added.push([...names]); if (failTools) throw new Error(PRIVATE_ERROR); tools.push(...names.filter(name => !tools.includes(name)));
      } },
      omRequestNotifier: { async notifyCreated(params: Notification): ReturnType<typeof notifyOmRequestCreated> {
        notifications.push(structuredClone(params)); if (failNotifier) throw new Error(PRIVATE_ERROR);
        return nullNotification ? null : { channel: "SYNTHETIC_CHANNEL", ts: "1111111111.000001" };
      } }
    };
    type Scope = typeof scope;
    const run = <T>(work: () => Promise<T>, actor: Session | null = author, ports: Partial<Scope> = scope) => runWithDataRepositories(ports, () => actors.run(actor, work));
    const post = (body = input(), ports: Partial<Scope> = scope) => run(() => collectionRoute.POST(request("POST", body)), author, ports);
    async function create(body = input()) {
      const response = await post(body); assert.equal(response.status, 201); return await response.json() as OmRequest;
    }
    async function rawBusiness() {
      const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
        .filter(name => name.startsWith(`${options.namespace}_`) && name !== store.collection("ActivityRequest").collectionName).sort();
      return Promise.all(names.map(async name => [name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]));
    }
    const sideCounts = () => ({ notifications: notifications.length, adds: added.length, reads: toolReads });
    async function withValidator<T>(model: string, extra: Document, work: () => Promise<T>): Promise<T> {
      const name = store.collection(model).collectionName;
      await store.db.command({ collMod: name, validator: { $and: [operationMongoValidator(model), extra] } });
      try { return await work(); }
      finally { await store.db.command({ collMod: name, validator: operationMongoValidator(model) }); }
    }
    function assertNoPrivateError(start: number, ...privateValues: string[]) {
      const output = logs.slice(start).map(values => inspect(values, { depth: 12 })).join("\n");
      for (const value of [PRIVATE_ERROR, ...privateValues]) assert.ok(!output.includes(value), "Logs exposed synthetic private error/data");
    }
    function assertIsolated() { assert.equal(pgCalls, 0); assert.equal(localCalls, 0); assert.equal(external.mock.callCount(), 0); }
    async function seedRequestPatch(id: string, patch: Record<string, unknown>) {
      // Native fixture mutation only, never invoke/pretend to implement scoped assignment.
      const row = await store.one("OmRequest", { _id: id }); assert.ok(row);
      await store.collection("OmRequest").replaceOne({ _id: id }, encodeMongoRuntimeDocument("OmRequest", completeMongoRow("OmRequest", { ...row, ...patch })));
    }

    await scope.teamUsers.createTeamUser({ name: author.user.name, email: author.user.email, slackId: "", team: "AX 1파트", role: "ld" });
    await scope.teamUsers.createTeamUser({ name: omRequestManagerName("1파트")!, email: manager.user.email, slackId: "", team: "AX 1파트", role: "om" });
    await scope.teamUsers.createTeamUser({ name: "Synthetic roster OM", email: "synthetic-om@day1company.co.kr", slackId: "", team: "AX 1파트", role: "om" });
    await scope.instructorNote.saveNote("Synthetic private instructor", { displayName: "Synthetic private instructor" });

    await suite.test("empty actual list/new page use native scoped services; protected server pages redirect anonymous", async () => {
      assert.deepEqual(component(await run(() => listPage()), "OmRequestTable").props.initialRequests, []);
      const form = component(await run(() => newPage()), "OmRequestForm");
      assert.equal(form.props.ldName, author.user.name); assert.equal(form.props.defaultTeam, "AX 1파트");
      assert.deepEqual(form.props.knownCompanies, []); assert.deepEqual(form.props.knownInstructors, ["Synthetic private instructor"]);
      assert.deepEqual(form.props.extraTools, tools);
      for (const page of [() => newPage(), () => listPage(), () => detailPage(context(randomUUID())), () => editPage(context(randomUUID()))]) {
        await assert.rejects(run(page, null, {}), /NEXT_REDIRECT/);
      }
      // completePage has no own auth gate: proxy authorization is deliberately not claimed here.
      const complete = await run(() => completePage({ searchParams: Promise.resolve({}) }));
      assert.ok(textOf(complete).includes("요청이 접수되었습니다")); assertIsolated();
    });

    await suite.test("actual POST maps N report/hackathon/courseId/education dates and records same-batch creation audits", async () => {
      const body = input("mapping"), response = await post(body);
      assert.equal(response.status, 201); const created = await response.json() as OmRequest;
      assert.equal(created.status, "배정필요"); assert.equal(created.ldEmail, author.user.email);
      assert.equal(created.slackChannel, "SYNTHETIC_CHANNEL"); assert.equal(created.slackThreadTs, "1111111111.000001");
      assert.equal(new Date(created.createdAt).toISOString(), created.createdAt); assert.deepEqual(created.sessions, body.sessions);
      assert.ok(created.operationId); assert.equal(created.courseId, body.courseId);
      const rounds = (await scope.operations.listOperations()).filter(row => row.courseId === body.courseId).sort((a, b) => String(a.roundNo).localeCompare(String(b.roundNo)));
      assert.equal(rounds.length, 2); assert.equal(rounds[0].operationId, created.operationId);
      assert.deepEqual(rounds.map(row => row.roundNo), ["1", "2"]);
      for (const [index, row] of rounds.entries()) {
        assert.equal(row.companyName, body.company); assert.equal(row.courseName, body.courseName); assert.equal(row.courseId, body.courseId);
        assert.equal(row.educationFormat, "검토필요"); assert.equal(row.hasResultReport, "불필요");
        assert.equal(row.operationStatus, "배정필요"); assert.equal(row.onsiteRequired, "Y");
        assert.equal(row.instructors, body.instructorName); assert.equal(row.region, body.sessions[index].location);
      }
      assert.deepEqual(rounds[0].educationDates, ["2099-10-01", "2099-10-03"]);
      assert.equal(rounds[0].startDate, "2099-10-01"); assert.equal(rounds[0].endDate, "2099-10-03");
      const batch = response.headers.get("X-Request-Id"); assert.ok(batch);
      const audits = await store.scan("ActivityChange", { requestId: batch });
      const requestCreates = audits.filter(row => row.targetType === "om_requests" && row.action === "create");
      const roundCreates = audits.filter(row => row.targetType === "operation_sessions" && row.action === "create");
      assert.equal(requestCreates.length, 1); assert.equal(requestCreates[0].targetId, created.id);
      assert.deepEqual(roundCreates.map(row => row.targetId).sort(), rounds.map(row => row.id).sort());
      for (const row of [...requestCreates, ...roundCreates]) {
        assert.equal(row.route, "/api/om-request"); assert.equal(row.method, "POST"); assert.equal(row.actorEmail, author.user.email);
      }
      assert.equal((await store.one("ActivityRequest", { _id: batch }))?.status, 201);
      const raw = JSON.stringify(await rawBusiness());
      const pii = [author.user.name, author.user.email, body.businessNumber!, body.instructorName, body.syncupLink, body.driveLink, body.notes, ...body.sessions.map(row => row.location)];
      for (const value of pii) assert.ok(!raw.includes(value), "Raw business/audit collections exposed private fixture data");
      const rawRequestAudit = JSON.stringify(await store.collection("ActivityRequest").findOne({ _id: batch }));
      assert.ok(!rawRequestAudit.includes(author.user.email));
      const changes = JSON.stringify(audits.map(row => row.changes));
      for (const value of pii) assert.ok(!changes.includes(value), "Decoded audit changes must still redact private fields");
      assert.equal(notifications.at(-1)?.ldEmail, author.user.email); assert.deepEqual(notifications.at(-1)?.sessions, body.sessions);
      assertIsolated();
    });

    await suite.test("every missing intake port fails preflight before business/ports; missing recorder throws before handler", async () => {
      for (const key of ["omRequests", "operations", "omCustomTools", "omRequestNotifier"] as const) {
        const partial: Partial<Scope> = { ...scope }; delete partial[key];
        const before = await rawBusiness(), sides = sideCounts();
        await expectJson(await post(input(), partial), 500, { error: "저장 실패" });
        assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides); assertIsolated();
      }
      const before = await rawBusiness(), sides = sideCounts();
      const partial: Partial<Scope> = { ...scope }; delete partial.requestActivity;
      await assert.rejects(post(input(), partial), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides); assertIsolated();
    });

    await suite.test("explicit scope wins even with a configured legacy PG selector; missing ports never use PG", async () => {
      process.env.OPERATION_DATA_SOURCE = "prisma";
      process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/forbidden_fixture";
      try {
        const created = await create(); assert.ok(created.operationId);
        for (const key of ["omRequests", "operations", "omCustomTools", "omRequestNotifier"] as const) {
          const partial: Partial<Scope> = { ...scope }; delete partial[key];
          const before = await rawBusiness(), sides = sideCounts();
          await expectJson(await post(input(), partial), 500, { error: "저장 실패" });
          assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides); assertIsolated();
        }
      } finally { process.env.OPERATION_DATA_SOURCE = "local"; delete process.env.DATABASE_URL; }
    });

    await suite.test("native core insert/audit failures yield fixed 500, roll back business and call no secondary port", async () => {
      for (const model of ["OmRequest", "ActivityChange"]) {
        const before = await rawBusiness(), sides = sideCounts(), start = logs.length, body = input();
        await withValidator(model, { _id: { $exists: false } }, async () => {
          await expectJson(await post(body), 500, { error: "저장 실패" });
        });
        assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides);
        assertNoPrivateError(start, author.user.email, body.notes, body.instructorName); assertIsolated();
      }
    });

    await suite.test("tool/notifier failures independently keep 201, linked rounds and LD metadata; null notifier keeps author", async () => {
      for (const failure of ["tools", "notifier", "disabled-notifier"] as const) {
        const start = logs.length, body = input(), sides = sideCounts();
        failTools = failure === "tools"; failNotifier = failure === "notifier"; nullNotification = failure === "disabled-notifier";
        try {
          const created = await create(body); assert.ok(created.operationId); assert.equal(created.ldEmail, author.user.email);
          assert.equal((await scope.operations.listOperations()).filter(row => row.courseId === body.courseId).length, 2);
          assert.equal(notifications.length, sides.notifications + 1);
          assert.equal(added.length, sides.adds + 1);
          if (failure !== "tools") { assert.equal(created.slackChannel, undefined); assert.equal(created.slackThreadTs, undefined); }
          assertNoPrivateError(start, author.user.email, body.notes); assertIsolated();
        } finally { failTools = false; failNotifier = false; nullNotification = false; }
      }
    });

    await suite.test("native operation failure keeps accepted request and cleans up partial rounds", async () => {
      for (const partial of [false, true]) {
        const body = input(), sides = sideCounts(), start = logs.length;
        const created = await withValidator("OperationSession", partial ? { roundNo: { $ne: "2" } } : { _id: { $exists: false } }, () => create(body));
        assert.equal(created.operationId, undefined); assert.equal(created.ldEmail, author.user.email);
        assert.ok(await repo.getOmRequest(created.id));
        assert.equal((await scope.operations.listOperations()).filter(row => row.courseId === body.courseId).length, 0);
        assert.equal(notifications.length, sides.notifications + 1); assert.equal(added.length, sides.adds + 1);
        assertNoPrivateError(start, author.user.email, body.notes); assertIsolated();
      }
    });

    await suite.test("report patch failure after round creation preserves partial updates and rolls back failed audit", async () => {
      for (const failedRound of ["1", "2"]) {
        const body = input(), sides = sideCounts(), start = logs.length;
        const response = await withValidator("OperationSession", {
          $nor: [{ roundNo: failedRound, hasResultReport: "NOT_REQUIRED" }]
        }, () => post(body));
        assert.equal(response.status, 201);
        const created = await response.json() as OmRequest;
        assert.equal(created.operationId, undefined);
        assert.equal(created.ldEmail, author.user.email);
        assert.equal(created.slackChannel, "SYNTHETIC_CHANNEL");
        const stored = await repo.getOmRequest(created.id);
        assert.ok(stored); assert.equal(stored.operationId, undefined);
        const rounds = (await scope.operations.listOperations()).filter(row => row.courseId === body.courseId)
          .sort((a, b) => String(a.roundNo).localeCompare(String(b.roundNo)));
        assert.equal(rounds.length, 2);
        assert.deepEqual(rounds.map(row => row.hasResultReport), failedRound === "1"
          ? ["확인필요", "확인필요"] : ["불필요", "확인필요"]);
        const audits = await store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id") });
        const roundAudits = audits.filter(row => row.targetType === "operation_sessions");
        assert.deepEqual(roundAudits.filter(row => row.action === "create").map(row => row.targetId).sort(), rounds.map(row => row.id).sort());
        const updates = roundAudits.filter(row => row.action === "update");
        assert.deepEqual(updates.map(row => row.targetId), failedRound === "1" ? [] : [rounds[0].id]);
        if (updates.length) assert.deepEqual((updates[0].changes as Record<string, unknown>).has_result_report,
          { before: "needs_review", after: "not_required" });
        assert.equal(notifications.length, sides.notifications + 1); assert.equal(added.length, sides.adds + 1);
        assertNoPrivateError(start, author.user.email, body.notes); assertIsolated();
      }
    });

    await suite.test("link/meta persistence failures remain secondary and do not claim a rollback of created operations", async () => {
      for (const field of ["operationId", "ldEmail"] as const) {
        const body = input(), sides = sideCounts();
        const created = await withValidator("OmRequest", { [field]: null }, () => create(body));
        assert.equal((await scope.operations.listOperations()).filter(row => row.courseId === body.courseId).length, 2);
        assert.equal(created[field], undefined); assert.ok(await repo.getOmRequest(created.id));
        assert.equal(notifications.length, sides.notifications + 1);
      }
      assertIsolated();
    });

    await suite.test("resubmission remains a fresh intake, not a new deduplication contract", async () => {
      const body = input(), sides = sideCounts(), first = await create(body), second = await create(body);
      assert.notEqual(first.id, second.id); assert.notEqual(first.operationId, second.operationId);
      assert.equal((await scope.operations.listOperations()).filter(row => row.courseId === body.courseId).length, 4);
      assert.equal(notifications.length, sides.notifications + 2); assertIsolated();
    });

    await suite.test("actual item PATCH preserves author/link/status and never updates linked operations or sends notifications", async () => {
      const body = input(), created = await create(body);
      const originalOperations = await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray();
      const forged = { ...body, courseName: "Synthetic edited course", ld: "Synthetic changed display", ldEmail: other.user.email,
        operationId: "forged", assignedOm: "forged", status: "배정완료", slackChannel: "forged" };
      const sides = sideCounts();
      await expectJson(await run(() => itemRoute.PATCH(request("PATCH", forged), context(created.id)), other), 403, { error: "본인이 작성한 요청만 수정할 수 있습니다." });
      for (const actor of [author, admin]) {
        const response = await run(() => itemRoute.PATCH(request("PATCH", forged), context(created.id)), actor);
        assert.equal(response.status, 200); const updated = await response.json() as OmRequest;
        assert.equal(updated.courseName, forged.courseName); assert.equal(updated.ld, forged.ld);
        assert.equal(updated.ldEmail, author.user.email); assert.equal(updated.operationId, created.operationId);
        assert.equal(updated.status, created.status); assert.equal(updated.assignedOm, created.assignedOm);
        assert.equal(updated.slackChannel, created.slackChannel); assert.equal(updated.createdAt, created.createdAt);
      }
      assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), originalOperations);
      assert.equal(notifications.length, sides.notifications);
      failTools = true;
      try { assert.equal((await run(() => itemRoute.PATCH(request("PATCH", body), context(created.id)))).status, 200); }
      finally { failTools = false; }
      await expectJson(await run(() => itemRoute.PATCH(request("PATCH", body), context(randomUUID()))), 404, { error: "요청 없음" });
      assertIsolated();
    });

    await suite.test("author delete policy: only own unassigned request, admin may delete assigned; no operation cascade", async () => {
      for (const assigned of [false, true]) {
        const created = await create();
        if (assigned) await seedRequestPatch(created.id, { assignedOm: "Synthetic assigned OM", status: "배정완료" });
        const operationRows = await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), sides = sideCounts();
        await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id)), other), 403, { error: "본인이 작성한 요청만 삭제할 수 있습니다." });
        if (assigned) await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id))), 403, { error: "OM 지정 완료된 요청은 관리자만 삭제할 수 있습니다." });
        await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id)), assigned ? admin : author), 200, { ok: true });
        assert.equal(await repo.getOmRequest(created.id), null); assert.ok(!(await repo.listOmRequests()).some(row => row.id === created.id));
        await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id)), admin), 404, { error: "요청 없음" });
        assert.deepEqual(await store.collection("OperationSession").find({}).sort({ _id: 1 }).toArray(), operationRows);
        assert.deepEqual(sideCounts(), sides);
      }
      const legacy = await create(); await seedRequestPatch(legacy.id, { ldEmail: null });
      await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(legacy.id))), 403, { error: "본인이 작성한 요청만 삭제할 수 있습니다." });
      await expectJson(await run(() => itemRoute.PATCH(request("PATCH", input()), context(legacy.id))), 403, { error: "본인이 작성한 요청만 수정할 수 있습니다." });
      assertIsolated();
    });

    await suite.test("native item write/audit failures preserve request and operation rows and emit fixed errors", async () => {
      const created = await create(), before = await rawBusiness(), sides = sideCounts(), start = logs.length;
      for (const key of ["omRequests", "omCustomTools"] as const) {
        const partial: Partial<Scope> = { ...scope }; delete partial[key];
        await expectJson(await run(() => itemRoute.PATCH(request("PATCH", input()), context(created.id)), author, partial), 500, { error: "저장 실패" });
        assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides);
      }
      await withValidator("OmRequest", { _id: { $exists: false } }, async () => {
        await expectJson(await run(() => itemRoute.PATCH(request("PATCH", input()), context(created.id))), 500, { error: "저장 실패" });
      });
      assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides);
      await withValidator("ActivityChange", { _id: { $exists: false } }, async () => {
        await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id))), 500, { error: "삭제 실패" });
      });
      assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides);
      assertNoPrivateError(start, author.user.email); assertIsolated();
    });

    await suite.test("intake-only scope rejects missing assignment ports before writes for linked and legacy requests", async () => {
      const created = await create();
      // Do not get a false-positive 409 merely because the old service refuses local JSON.
      process.env.OPERATION_DATA_SOURCE = "prisma";
      process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/forbidden_fixture";
      try {
        for (const linked of [true, false]) {
          if (!linked) await seedRequestPatch(created.id, { operationId: null });
          const before = await rawBusiness(), sides = sideCounts();
          for (const [method, handler] of [["POST", assignmentRoute.POST], ["PATCH", assignmentRoute.PATCH]] as const) {
            const payload = { id: created.id, assignedOm: "Synthetic roster OM", confirmationToken: "synthetic-token-not-an-implementation" };
            assert.equal((await run(() => handler(request(method, payload)), other)).status, 403, "Real authorization precedes missing-port handling");
            const response = await run(() => handler(request(method, payload)), manager);
            assert.equal(response.status, 500); assert.equal(response.headers.get("Cache-Control"), "no-store");
            const body = await response.json(); assert.match(body.error, /배정을 처리하지 못했습니다/);
            assert.ok(!JSON.stringify(body).includes("Synthetic roster OM"));
          }
          // Direct assignment helpers and scope isolation belong to omRequestBoundary.test.ts.
          assert.deepEqual(await rawBusiness(), before); assert.deepEqual(sideCounts(), sides); assertIsolated();
        }
      } finally { process.env.OPERATION_DATA_SOURCE = "local"; delete process.env.DATABASE_URL; }
    });

    await suite.test("all actual server pages expose scoped native data and retain edit/delete/assignment props", async () => {
      const body = input("pages"), created = await create(body);
      const form = component(await run(() => newPage()), "OmRequestForm");
      assert.ok((form.props.knownCompanies as string[]).includes(body.company));
      const rows = component(await run(() => listPage()), "OmRequestTable").props.initialRequests as OmRequest[];
      assert.ok(rows.some(row => row.id === created.id));
      assert.deepEqual(rows.map(row => row.createdAt), rows.map(row => row.createdAt).sort()); // server props; client defaults are separate
      for (const actor of [author, other, admin, manager]) {
        const page = await run(() => detailPage(context(created.id)), actor);
        const actions = component(page, "RequestActions").props, assign = component(page, "AssignForm").props;
        assert.equal(actions.isAuthor, actor === author); assert.equal(actions.isAdmin, actor === admin); assert.equal(actions.isAssigned, false);
        assert.equal(assign.canAssign, actor === manager); assert.equal((assign.request as OmRequest).id, created.id);
        assert.ok((assign.omRoster as string[]).includes("Synthetic roster OM")); assert.ok(Array.isArray(assign.recommendations));
        assert.ok(elements(page).some(element => element.props.href === `/operations/${created.operationId}`));
      }
      for (const actor of [author, admin]) {
        const edit = component(await run(() => editPage(context(created.id)), actor), "OmRequestForm");
        assert.equal(edit.props.requestId, created.id); assert.equal((edit.props.initialData as OmRequestInput).courseName, body.courseName);
        assert.deepEqual(edit.props.knownInstructors, ["Synthetic private instructor"]);
        for (const field of ["id", "createdAt", "status", "assignedOm", "operationId"]) assert.ok(!Object.hasOwn(edit.props.initialData as object, field));
      }
      await assert.rejects(run(() => editPage(context(created.id)), other), /NEXT_REDIRECT/);
      const completed = await run(() => completePage({ searchParams: Promise.resolve({ id: created.id }) }));
      assert.ok(elements(completed).some(element => element.props.href === `/operations/${created.operationId}`));
      // Inspect Field props too: server-page tree traversal intentionally does not execute UI leaves.
      assert.ok(elements(completed).some(element => element.props.value === body.company));
      assert.ok(textOf(completed).includes("10/1, 10/3 (2일)"));
      await seedRequestPatch(created.id, { assignedOm: "Synthetic assigned OM", status: "배정완료" });
      assert.equal(component(await run(() => detailPage(context(created.id))), "RequestActions").props.isAssigned, true);
      await seedRequestPatch(created.id, { operationId: null });
      assert.ok(elements(await run(() => detailPage(context(created.id)))).some(element => element.props.href === `/operations/new?fromRequestId=${created.id}`));
      for (const page of [detailPage, editPage]) await assert.rejects(run(() => page(context(randomUUID()))), /NEXT_HTTP_ERROR_FALLBACK;404/);
      assertIsolated();
    });

    await suite.test("legacy encrypted JSON-null sessions reach actual server pages as an empty DTO without a repair write", async () => {
      // Native repository getter/list coverage lives in mongoOmRequestRepository.integration.test.ts.
      // This case covers the real page consumers, not a new null-to-empty persistence policy.
      const created = await create();
      const original = await store.collection("OmRequest").findOne({ _id: created.id }); assert.ok(original);
      await seedRequestPatch(created.id, { sessions: MongoJsonNull });
      const before = await rawBusiness(), sides = sideCounts();
      try {
        const rows = component(await run(() => listPage()), "OmRequestTable").props.initialRequests as OmRequest[];
        assert.deepEqual(rows.find(row => row.id === created.id)?.sessions, []);
        const detail = component(await run(() => detailPage(context(created.id))), "AssignForm");
        assert.deepEqual((detail.props.request as OmRequest).sessions, []);
        const edit = component(await run(() => editPage(context(created.id))), "OmRequestForm");
        assert.deepEqual((edit.props.initialData as OmRequestInput).sessions, []);
        const completed = await run(() => completePage({ searchParams: Promise.resolve({ id: created.id }) }));
        assert.ok(textOf(completed).includes("요청이 접수되었습니다"));
        assert.ok(!elements(completed).some(element => element.props.className === "om-session-list-row"));
        assert.equal((await store.one("OmRequest", { _id: created.id }))?.sessions, MongoJsonNull);
        assert.deepEqual(await rawBusiness(), before);
        assert.equal(notifications.length, sides.notifications); assert.equal(added.length, sides.adds);
        assertIsolated();
      } finally { await store.collection("OmRequest").replaceOne({ _id: created.id }, original); }
    });

    await suite.test("page missing services and native corrupt ciphertext reject rather than falling back or returning partial rows", async () => {
      const created = await create();
      const cases = [
        { page: () => newPage(), keys: ["omCustomTools", "teamUsers", "operations", "instructorNote"] },
        { page: () => listPage(), keys: ["omRequests"] },
        { page: () => detailPage(context(created.id)), keys: ["omRequests", "operations", "teamMembers", "teamUsers"] },
        { page: () => editPage(context(created.id)), keys: ["omRequests", "omCustomTools", "instructorNote"] },
        { page: () => completePage({ searchParams: Promise.resolve({ id: created.id }) }), keys: ["omRequests"] }
      ];
      const before = await rawBusiness();
      for (const entry of cases) for (const key of entry.keys) {
        const partial: Partial<Scope> = { ...scope }; delete partial[key as keyof Scope];
        await assert.rejects(run(entry.page, author, partial), /DATA_REPOSITORY_NOT_CONFIGURED/); assertIsolated();
      }
      assert.deepEqual(await rawBusiness(), before);
      const raw = await store.collection("OmRequest").findOne({ _id: created.id }); assert.ok(raw);
      await store.collection("OmRequest").updateOne({ _id: created.id }, { $set: { ld: PRIVATE_ERROR } }, { bypassDocumentValidation: true });
      const start = logs.length;
      try {
        for (const page of [() => listPage(), () => detailPage(context(created.id)), () => editPage(context(created.id)),
          () => completePage({ searchParams: Promise.resolve({ id: created.id }) })]) {
          await assert.rejects(run(page), error => { assert.ok(!inspect(error).includes(PRIVATE_ERROR)); return true; });
        }
        await expectJson(await run(() => itemRoute.PATCH(request("PATCH", input()), context(created.id))), 500, { error: "저장 실패" });
        await expectJson(await run(() => itemRoute.DELETE(request("DELETE"), context(created.id))), 500, { error: "삭제 실패" });
        assertNoPrivateError(start); assertIsolated();
      } finally { await store.collection("OmRequest").replaceOne({ _id: created.id }, raw); }
    });

    await suite.test("late native request-log failure preserves 201 and emits only non-sensitive error", async () => {
      const start = logs.length;
      await withValidator("ActivityRequest", { status: { $lt: 0 } }, async () => {
        const response = await post(); assert.equal(response.status, 201);
        const created = await response.json() as OmRequest; assert.ok(await repo.getOmRequest(created.id));
        const id = response.headers.get("X-Request-Id"); assert.ok(id);
        assert.equal(await store.collection("ActivityRequest").countDocuments({ _id: id }), 0);
        assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: id, targetType: "om_requests", action: "create" }), 1);
      });
      assertNoPrivateError(start, author.user.email); assertIsolated();
    });
    assertIsolated();
  } finally {
    hooks.deregister();
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        for (const restore of restores.reverse()) restore(); syncBuiltinESMExports();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
