/** Actual assignment handlers on isolated native Mongo; execution evidence is
 * recorded under .claude/plans/mongodb-om-assignment.
 * Plan-v2 / validation-v2 / source-findings: actual POST/PATCH, real withActivity,
 * authorization helper, Mongo repositories and authenticated native codecs.
 * Only auth session supply is mocked; external ports are typed scope inputs.
 * PG/fetch/local-file replacements are tripwires, never substitute business services.
 * New compile-time gates: mongoOmAssignmentRepository and DataRepositories keys
 * omAssignment, omAssignmentCalendar.reflectOperationUpdated,
 * omAssignmentNotifier.notifyAssigned. No fallback stubs/skip on missing modules.
 * V14–V16 + V17 server contract; existing AssignForm.test.ts remains the UI check.
 * Commit fault injection below covers handler effects; native wire-112 races and
 * PG oracle evidence belong to other owners, not these injected-error cases.
 * No browser E2E, UI implementation, real source data or production DB coverage.
 * Explicit opt-in only:
 * MONGODB_OM_ASSIGNMENT_TEST_URI=mongodb://127.0.0.1:27819/?replicaSet=omassignment20260929
 * Run in a dedicated test process with repository's module-mock/TS loader flags.
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
import { ClientSession, MongoClient, MongoServerError, type Document } from "mongodb";
import type { OmRequest, OmRequestInput } from "./omRequest/omRequestTypes";
import type { notifyOmAssigned, notifyOmRequestCreated } from "../slack/notifySlack";

import type { reflectOperationUpdated } from "../googleCalendar/reflectOperationToCalendar";
import type { DataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
type Notification = Parameters<typeof notifyOmRequestCreated>[0];
const actors = new AsyncLocalStorage<Session | null>();
const author: Session = { user: { email: "synthetic-author@day1company.co.kr", name: "Synthetic private LD" }, expires: "" };
const admin: Session = { user: { email: "synthetic-admin@day1company.co.kr", name: "Synthetic admin" }, expires: "" };
const other: Session = { user: { email: "synthetic-other@day1company.co.kr", name: "Synthetic other" }, expires: "" };
const manager: Session = { user: { email: "synthetic-manager@day1company.co.kr", name: "Display name is not authority" }, expires: "" };
const PRIVATE_ERROR = "synthetic-private-failure@example.invalid";
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

const uri = process.env.MONGODB_OM_ASSIGNMENT_TEST_URI;
test("OM assignment actual handlers: native transactions, authorization, scoped ports and committed effects", {
  skip: !uri, timeout: 240_000
}, async suite => {
  // Never infer a target, load an env file, start MongoDB, or touch another database.
  assert.ok([
    "mongodb://127.0.0.1:27819/?replicaSet=omassignment20260929",
    "mongodb://127.0.0.1:27829/?replicaSet=importstaging20260930",
    "mongodb://127.0.0.1:27839/?replicaSet=importpromotion20260930"
  ].includes(uri!));
  const expectedReplica = new URL(uri!).searchParams.get("replicaSet");
  const saved = new Map(["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS",
    "DEV_AUTH_BYPASS", "DATABASE_URL", "OPERATION_DATA_SOURCE", "AUTH_SECRET", "NEXTAUTH_SECRET"].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    AUTH_SECRET: randomBytes(32).toString("base64"), OPERATION_DATA_SOURCE: "local"
  });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS; delete process.env.NEXTAUTH_SECRET;
  const databaseName = `hub_om_shadow_om_assignment_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000, monitorCommands: true });
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

  const hooks = registerHooks({
    resolve(specifier, resolution, next) {
      return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, resolution);
    }
  });
  // Keep command metadata only: neither command documents nor private values are logged.
  const writes: Array<{ collection: string; command: string }> = [];
  client.on("commandStarted", event => {
    if (event.databaseName !== databaseName) return;
    if (!["insert", "update", "delete", "findAndModify", "bulkWrite"].includes(event.commandName)) return;
    const name = event.command[event.commandName];
    writes.push({ collection: typeof name === "string" ? name : "bulkWrite", command: event.commandName });
  });
  try {
    const { MongoOmAssignmentRepository, prepareMongoOmAssignmentStore } = await import("./mongoOmAssignmentRepository");
    const { MongoOmRequestRepository, prepareMongoOmRequestStore, OM_REQUEST_MODELS } = await import("./mongoOmRequestRepository");
    const { MongoOperationRepository } = await import("./mongoOperationRepository");
    const { MongoOperationStore, completeMongoRow, prepareMongoOperationStore, operationMongoValidator, OPERATION_MODELS } = await import("./mongoOperationStore");
    const { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } = await import("./mongoRequestAuditRepository");
    const { MongoTeamUserRepository, prepareMongoTeamUserStore } = await import("./teamUsers/mongoTeamUserRepository");
    const { encodeMongoRuntimeDocument } = await import("./mongoRuntimeCodec");
    const { courseNameRestoreGuardCollection } = await import("./mongoCourseNameRestoreGuard");
    const { runWithDataRepositories, getDataRepositoryOverride } = await import("./dataRepositoryContext");
    const { activityContext } = await import("../activity/context");
    const { omRequestManagerName, hasOmRequestAssignmentOverride } = await import("./omRequest/omRequestTypes");
    const confirmed = await import("./omRequest/omRequestAssignment");
    const { updateOmRequestAssignment } = await import("./omRequest/omRequestLocalRepository");
    const { syncAssignedOmToLinkedOperation } = await import("./omRequest/omRequestOperationLink");
    const collectionRoute = await import("../../app/api/om-request/route");
    const assignmentRoute = await import("../../app/api/om-request/assign/route");
    await client.connect(); connected = true;
    assert.equal((await client.db("admin").command({ hello: 1 })).setName, expectedReplica);

    type Preview = Awaited<ReturnType<typeof confirmed.previewOmAssignment>>;
    type Observation = {
      kind: "calendar" | "slack";
      operationId?: string;
      payload?: Parameters<typeof notifyOmAssigned>[0];
      requestId: string;
      request: OmRequest | null;
      rounds: Array<{ id: unknown; omName: unknown; omUserId: unknown }>;
      audits: Array<{ targetId: unknown; targetType: unknown; actorEmail: unknown }>;
    };
    type Expectation = { id: string; ids: string[]; nextOm: string | null; auditIds: string[] };
    async function makeHarness(namespace: string) {
      const options = { client, databaseName, namespace, allowShadowWrites: true as const };
      await prepareMongoOperationStore({ ...options, processSequenceHighWater: 0 });
      await prepareMongoOmRequestStore(options);
      await prepareMongoRequestAuditStore(options);
      await prepareMongoTeamUserStore(options);
      await prepareMongoOmAssignmentStore(options);
      const store = new MongoOperationStore(options, [...new Set([...OM_REQUEST_MODELS, ...OPERATION_MODELS, ...REQUEST_AUDIT_MODELS])]);
      // Assignment preparation must reuse the already-defined restore guard, not invent a collection.
      assert.ok(await store.db.listCollections({ name: courseNameRestoreGuardCollection(store).collectionName }).next());
      const repo = await MongoOmRequestRepository.open(options);
      const assignment = await MongoOmAssignmentRepository.open(options);
      const operations = await MongoOperationRepository.open(options);
      const teamUsers = await MongoTeamUserRepository.open(options);
      const observations: Observation[] = [];
      const intakeNotifications: Notification[] = [];
      const customTools: string[] = [];
      const control: { expected?: Expectation; failCalendar: boolean; failSlack: boolean } = { failCalendar: false, failSlack: false };
      const observe = async (kind: Observation["kind"], operationId?: string, payload?: Observation["payload"]) => {
        const expected = control.expected;
        // Persist observations and assert OUTSIDE route's best-effort catch blocks.
        // Independent nontransaction reads cannot see uncommitted transaction changes.
        const requestId = activityContext.getStore()?.requestId ?? "";
        const rounds = expected ? await store.scan("OperationSession", { _id: { $in: expected.ids } }) : [];
        const audits = requestId ? await store.scan("ActivityChange", { requestId }) : [];
        observations.push({ kind, operationId, payload: payload && structuredClone(payload), requestId,
          request: expected ? await repo.getOmRequest(expected.id) : null,
          rounds: rounds.map(({ id, omName, omUserId }) => ({ id, omName, omUserId })),
          audits: audits.map(({ targetId, targetType, actorEmail }) => ({ targetId, targetType, actorEmail })) });
      };
      const calendar: { reflectOperationUpdated: typeof reflectOperationUpdated } = {
        async reflectOperationUpdated(operation) {
          await observe("calendar", operation.operationId);
          if (control.failCalendar) throw new Error(PRIVATE_ERROR);
        }
      };
      const notifier: { notifyAssigned: typeof notifyOmAssigned } = {
        async notifyAssigned(payload) {
          await observe("slack", undefined, payload);
          if (control.failSlack) throw new Error(PRIVATE_ERROR);
        }
      };
      const scope = {
        omAssignment: assignment, omRequests: repo, operations, teamUsers,
        requestActivity: await MongoRequestAuditRepository.open(options),
        omAssignmentCalendar: calendar, omAssignmentNotifier: notifier,
        omCustomTools: { list: () => [...customTools], add: (names: string[]) => { customTools.push(...names); } },
        omRequestNotifier: { async notifyCreated(params: Notification): ReturnType<typeof notifyOmRequestCreated> {
          intakeNotifications.push(structuredClone(params));
          return { channel: "SYNTHETIC_CHANNEL", ts: "1111111111.000001" };
        } }
      } satisfies Partial<DataRepositories>;
      const run = <T>(work: () => Promise<T>, actor: Session | null = manager, ports: Partial<DataRepositories> = scope) =>
        runWithDataRepositories(ports, () => actors.run(actor, work));
      const invoke = (method: "POST" | "PATCH", body: unknown, actor: Session | null = manager, ports: Partial<DataRepositories> = scope) =>
        run(() => assignmentRoute[method](new Request("https://example.invalid/api/om-request/assign", {
          method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        })), actor, ports);
      async function expectResponse(response: Response, status: number) {
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const id = response.headers.get("X-Request-Id"); assert.ok(id);
        const log = await store.one("ActivityRequest", { _id: id });
        assert.equal(log?.status, status); assert.equal(log?.route, "/api/om-request/assign");
        const body = await response.json();
        assert.ok(!JSON.stringify(body).includes(PRIVATE_ERROR));
        if (status >= 400) assert.equal(typeof body.error, "string");
        return body;
      }
      async function create(body = input()) {
        const response = await run(() => collectionRoute.POST(request("POST", body)), author);
        assert.equal(response.status, 201);
        const created = await response.json() as OmRequest;
        const batch = response.headers.get("X-Request-Id"); assert.ok(batch);
        const metadata = await store.scan("ActivityChange", { requestId: batch, route: "/api/om-request", method: "POST", action: "create" });
        const requests = metadata.filter(row => row.targetType === "om_requests");
        const rounds = metadata.filter(row => row.targetType === "operation_sessions");
        assert.equal(requests.length, 1); assert.equal(requests[0].targetId, created.id);
        assert.equal(rounds.length, 2); assert.equal(new Set(rounds.map(row => row.targetId)).size, 2);
        const ids = rounds.map(row => String(row.targetId)).sort();
        const stored = await store.scan("OperationSession", { _id: { $in: ids } });
        assert.equal(stored.length, 2); assert.ok(stored.some(row => row.operationId === created.operationId));
        assert.equal(intakeNotifications.at(-1)?.ldEmail, author.user.email);
        return { created, ids, operationIds: stored.map(row => String(row.operationId)), batch };
      }
      async function preview(id: string, assignedOm: string | null, actor: Session | null = manager) {
        const body = await expectResponse(await invoke("POST", { id, assignedOm }, actor), 200);
        const result = body.preview as Preview;
        assert.match(result.token, /^\d{13}\.[0-9a-f]{64}$/);
        assert.equal(result.count, 2); assert.equal(result.operations.length, 2);
        assert.equal(result.nextOm, assignedOm?.trim() || null);
        for (const round of result.operations) {
          assert.equal(typeof round.operationId, "string"); assert.ok(Object.hasOwn(round, "omName")); assert.ok(Object.hasOwn(round, "omUserId"));
        }
        return result;
      }
      const confirm = (id: string, assignedOm: string | null, token: string, actor: Session | null = manager, ports: Partial<DataRepositories> = scope) =>
        invoke("PATCH", { id, assignedOm, confirmationToken: token }, actor, ports);
      async function snapshot(includeGuard = true) {
        const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
          .filter(name => name.startsWith(`${namespace}_`) && name !== store.collection("ActivityRequest").collectionName
            && (includeGuard || name !== courseNameRestoreGuardCollection(store).collectionName)).sort();
        return Promise.all(names.map(async name => [name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]));
      }
      function mutationCount() {
        return writes.filter(event => (event.collection.startsWith(`${namespace}_`)
          && event.collection !== store.collection("ActivityRequest").collectionName) || event.collection === "bulkWrite").length;
      }
      async function patch(model: string, id: string, values: Record<string, unknown>) {
        const row = await store.one(model, { _id: id }); assert.ok(row);
        await store.collection(model).replaceOne({ _id: id }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...row, ...values })));
      }
      async function withValidator<T>(model: string, extra: Document, work: () => Promise<T>): Promise<T> {
        const name = store.collection(model).collectionName;
        await store.db.command({ collMod: name, validator: { $and: [operationMongoValidator(model), extra] } });
        try { return await work(); }
        finally { await store.db.command({ collMod: name, validator: operationMongoValidator(model) }); }
      }
      function arm(fixture: Awaited<ReturnType<typeof create>>, nextOm: string | null, auditIds = [...fixture.ids, fixture.created.id]) {
        observations.length = 0; control.expected = { id: fixture.created.id, ids: fixture.ids, nextOm, auditIds };
      }
      function assertEffects(operationIds: string[], slack: number) {
        assert.deepEqual(observations.filter(row => row.kind === "calendar").map(row => row.operationId).sort(), [...operationIds].sort());
        assert.equal(observations.filter(row => row.kind === "slack").length, slack);
        for (const observation of observations) {
          const expected = control.expected; assert.ok(expected);
          assert.equal(observation.request?.assignedOm ?? null, expected.nextOm);
          assert.equal(observation.request?.status, expected.nextOm ? "배정완료" : "배정필요");
          assert.deepEqual(observation.rounds.map(row => row.id).sort(), [...expected.ids].sort());
          for (const round of observation.rounds) { assert.equal(round.omName, expected.nextOm); assert.equal(round.omUserId, null); }
          assert.deepEqual(observation.audits.map(row => row.targetId).sort(), [...expected.auditIds].sort(), "All changes must already be committed at first external call");
          assert.ok(observation.audits.every(row => row.actorEmail === manager.user.email));
        }
      }
      const managerRow = await teamUsers.createTeamUser({ name: omRequestManagerName("1파트")!, email: manager.user.email, slackId: "", team: "AX 1파트", role: "om" });
      await teamUsers.createTeamUser({ name: author.user.name, email: author.user.email, slackId: "", team: "AX 1파트", role: "ld" });
      return { options, store, repo, assignment, scope, run, invoke, expectResponse, create, preview, confirm,
        snapshot, mutationCount, patch, withValidator, arm, assertEffects, observations, control, managerRow };
    }
    function assertIsolated() {
      assert.equal(pgCalls, 0); assert.equal(localCalls, 0); assert.equal(external.mock.callCount(), 0);
    }
    function assertSafeLogs(start: number) {
      for (const values of logs.slice(start)) {
        assert.equal(values.length, 1, "Log only a fixed message, never an exception object");
        assert.equal(typeof values[0], "string");
        assert.match(String(values[0]), /^\[(om-request|activity)\]/);
      }
      const output = inspect(logs.slice(start), { depth: 12 });
      for (const value of [PRIVATE_ERROR, manager.user.email, author.user.email]) assert.ok(!output.includes(value));
    }
    const h = await makeHarness("shadow_assignment_handlers");
    const OM = "Synthetic unregistered private assignee";

    await suite.test("V14: actual handlers preserve auth/body/read/permission order and 401/403/400/404/409 no-store", async () => {
      const { created } = await h.create();
      const before = await h.snapshot(), mutations = h.mutationCount();
      for (const method of ["POST", "PATCH"] as const) {
        // Empty business scope proves anonymous/body validation happen before repository lookup.
        const loggingOnly = { requestActivity: h.scope.requestActivity };
        await h.expectResponse(await h.invoke(method, [], null, loggingOnly), 401);
        for (const body of [null, [], {}, { id: "", assignedOm: OM }, { id: "x".repeat(201), assignedOm: OM },
          ...[undefined, " ", 123, {}, "x".repeat(201)].map(assignedOm => ({ id: created.id, assignedOm }))]) {
          await h.expectResponse(await h.invoke(method, body, manager, loggingOnly), 400);
        }
        const malformed = await h.run(() => assignmentRoute[method](new Request("https://example.invalid/api/om-request/assign", { method, body: "{" })));
        await h.expectResponse(malformed, 400);
        await h.expectResponse(await h.invoke(method, { id: randomUUID(), assignedOm: OM }, other), 404);
        for (const actor of [author, other, admin, { ...other, user: { ...other.user, name: omRequestManagerName("1파트")! } }]) {
          await h.expectResponse(await h.invoke(method, { id: created.id, assignedOm: OM }, actor), 403);
        }
      }
      assert.equal(h.mutationCount(), mutations, "Rejected auth/body/not-found checks must submit no business/guard writes");
      for (const confirmationToken of [undefined, null, "", "invalid", "x".repeat(513)]) {
        await h.expectResponse(await h.invoke("PATCH", { id: created.id, assignedOm: OM, confirmationToken }), 409);
      }
      assert.deepEqual(await h.snapshot(), before);
      // Invalid token formats may enter and abort a guard transaction; earlier HTTP checks may not write.
      assert.equal(h.observations.length, 0); assertIsolated();
    });

    await suite.test("V14/V17: real intake exact batch, preview contract, no business/guard writes and unregistered OM accepted", async () => {
      const f = await h.create();
      assert.ok(!(await h.scope.teamUsers.listTeamUsers()).some(row => row.name === OM));
      h.arm(f, OM);
      const before = await h.snapshot(), writesBefore = h.mutationCount();
      const preview = await h.preview(f.created.id, `  ${OM}  `);
      assert.equal(preview.assignedOm, null);
      assert.deepEqual(preview.operations.map(row => row.operationId), f.operationIds);
      assert.deepEqual(await h.snapshot(), before); assert.equal(h.mutationCount(), writesBefore);
      h.assertEffects([], 0);
      const response = await h.confirm(f.created.id, OM, preview.token);
      const updated = await h.expectResponse(response, 200) as OmRequest;
      assert.deepEqual(updated, { ...f.created, assignedOm: OM, status: "배정완료" });
      h.assertEffects(f.operationIds, 1);
      const payload = h.observations.find(row => row.kind === "slack")?.payload;
      assert.deepEqual(payload, { company: updated.company, courseName: updated.courseName, assignedOm: OM,
        ld: updated.ld, ldEmail: updated.ldEmail, channel: updated.slackChannel, threadTs: updated.slackThreadTs });
      const rounds = await h.store.scan("OperationSession", { _id: { $in: f.ids } });
      assert.ok(rounds.every(row => row.operationStatus === "ASSIGNMENT_PLANNED"));
      const auditId = response.headers.get("X-Request-Id")!;
      const audits = await h.store.scan("ActivityChange", { requestId: auditId });
      assert.equal(audits.length, 3);
      for (const row of audits) {
        assert.equal(row.route, "/api/om-request/assign"); assert.equal(row.method, "PATCH"); assert.equal(row.action, "update");
        assert.equal(row.actorEmail, manager.user.email); assert.equal(row.actorType, "user");
        const changes = row.changes as Record<string, unknown>;
        assert.deepEqual(changes[row.targetType === "om_requests" ? "assigned_om" : "om_name"], { redacted: true });
      }
      const raw = JSON.stringify(await h.snapshot());
      for (const value of [OM, author.user.email, manager.user.email, f.created.notes, preview.token]) assert.ok(!raw.includes(value));
      assertIsolated();
    });

    await suite.test("V16: exact creation batch excludes another request's rounds in the same course", async () => {
      const body = input(), first = await h.create(body), second = await h.create(body);
      const otherRows = await h.store.collection("OperationSession").find({ _id: { $in: second.ids } }).sort({ _id: 1 }).toArray();
      const otherRequest = await h.store.collection("OmRequest").findOne({ _id: second.created.id });
      const firstRow = await h.store.one("OperationSession", { _id: first.ids[0] });
      const secondRow = await h.store.one("OperationSession", { _id: second.ids[0] });
      assert.equal(firstRow?.courseRecordId, secondRow?.courseRecordId);
      h.arm(first, OM);
      const p = await h.preview(first.created.id, OM);
      assert.deepEqual(p.operations.map(row => row.operationId), first.operationIds);
      await h.expectResponse(await h.confirm(first.created.id, OM, p.token), 200);
      h.assertEffects(first.operationIds, 1);
      assert.deepEqual(await h.store.collection("OperationSession").find({ _id: { $in: second.ids } }).sort({ _id: 1 }).toArray(), otherRows);
      assert.deepEqual(await h.store.collection("OmRequest").findOne({ _id: second.created.id }), otherRequest);
      assertIsolated();
    });

    await suite.test("V14: missing signing secrets produce safe 500 and no committed business changes", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      const secret = process.env.AUTH_SECRET, fallback = process.env.NEXTAUTH_SECRET;
      const before = await h.snapshot(), start = logs.length;
      delete process.env.AUTH_SECRET; delete process.env.NEXTAUTH_SECRET;
      try {
        for (const method of ["POST", "PATCH"] as const) {
          const response = await h.invoke(method, { id: f.created.id, assignedOm: OM, confirmationToken: p.token });
          assert.deepEqual(await h.expectResponse(response, 500), { error: "배정을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." });
          assert.deepEqual(await h.snapshot(), before); h.assertEffects([], 0);
        }
      } finally {
        if (secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = secret;
        if (fallback === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = fallback;
      }
      assertSafeLogs(start); assertIsolated();
    });

    await suite.test("V14: missing/duplicate manager name, duplicate canonical email, native roster failure and post-preview revocation fail closed", async () => {
      const f = await h.create(), token = (await h.preview(f.created.id, OM)).token;
      const managerDoc = await h.store.collection("TeamUser").findOne({ _id: h.managerRow.id }); assert.ok(managerDoc);
      const managerDecoded = await h.store.one("TeamUser", { _id: h.managerRow.id }); assert.ok(managerDecoded);
      async function denyBoth() {
        const before = await h.snapshot(), start = h.mutationCount(), effects = h.observations.length;
        for (const method of ["POST", "PATCH"] as const) {
          await h.expectResponse(await h.invoke(method, { id: f.created.id, assignedOm: OM, confirmationToken: token }), 403);
        }
        assert.deepEqual(await h.snapshot(), before); assert.equal(h.mutationCount(), start); assert.equal(h.observations.length, effects);
      }
      try {
        await h.store.collection("TeamUser").deleteOne({ _id: h.managerRow.id });
        await denyBoth();
      } finally { await h.store.collection("TeamUser").replaceOne({ _id: h.managerRow.id }, managerDoc, { upsert: true }); }
      for (const values of [
        { name: h.managerRow.name, email: "synthetic-duplicate-manager@day1company.co.kr" },
        { name: "Synthetic different name", email: ` ${manager.user.email.toUpperCase()} ` }
      ]) {
        // Direct synthetic fixture insert represents corrupt/legacy roster ambiguity, bypassing create's duplicate check.
        const id = randomUUID();
        await h.store.collection("TeamUser").insertOne(encodeMongoRuntimeDocument("TeamUser", completeMongoRow("TeamUser", { ...managerDecoded, ...values, id })));
        try { await denyBoth(); } finally { await h.store.collection("TeamUser").deleteOne({ _id: id }); }
      }
      const start = logs.length;
      try {
        await h.store.collection("TeamUser").updateOne({ _id: h.managerRow.id }, { $set: { email: PRIVATE_ERROR } }, { bypassDocumentValidation: true });
        await denyBoth(); // Real authenticated codec failure, not mocked listTeamUsers.
      } finally { await h.store.collection("TeamUser").replaceOne({ _id: h.managerRow.id }, managerDoc); }
      assertSafeLogs(start);
      try {
        await h.patch("TeamUser", h.managerRow.id, { email: "synthetic-new-manager@day1company.co.kr" });
        await denyBoth(); // Same previously issued token; PATCH must re-evaluate current roster.
      } finally { await h.store.collection("TeamUser").replaceOne({ _id: h.managerRow.id }, managerDoc); }
      h.arm(f, OM);
      await h.expectResponse(await h.confirm(f.created.id, OM, token), 200);
      h.assertEffects(f.operationIds, 1); assertIsolated();
    });

    await suite.test("V14: existing explicit override remains valid with missing roster; no new privilege policy", async () => {
      // Read the PUBLIC policy constant; do not copy an existing person's address into synthetic fixtures.
      // No source/production directory is read. This session is synthetic; the policy is exercised as-is.
      const source = originalRead(new URL("./omRequest/omRequestTypes.ts", import.meta.url), "utf8");
      const values = /const OM_REQUEST_ASSIGN_OVERRIDE_EMAILS\s*=\s*\[([^\]]+)\]/.exec(source)?.[1].match(/"([^"]+)"/g) ?? [];
      const email = values.map(value => value.slice(1, -1)).find(hasOmRequestAssignmentOverride); assert.ok(email);
      const actor: Session = { user: { email, name: "Synthetic policy override session" }, expires: "" };
      const f = await h.create();
      const raw = await h.store.collection("TeamUser").findOne({ _id: h.managerRow.id }); assert.ok(raw);
      try {
        await h.store.collection("TeamUser").deleteOne({ _id: h.managerRow.id });
        const before = await h.snapshot();
        const p = await h.preview(f.created.id, OM, actor);
        assert.deepEqual(await h.snapshot(), before);
        h.arm(f, OM);
        const response = await h.confirm(f.created.id, OM, p.token, actor);
        await h.expectResponse(response, 200);
        assert.deepEqual(h.observations.filter(row => row.kind === "calendar").map(row => row.operationId).sort(), [...f.operationIds].sort());
        assert.equal(h.observations.filter(row => row.kind === "slack").length, 1);
        const audits = await h.store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id")! });
        assert.equal(audits.length, 3); assert.ok(audits.every(row => row.actorEmail === email));
      } finally { await h.store.collection("TeamUser").replaceOne({ _id: h.managerRow.id }, raw, { upsert: true }); }
      assertIsolated();
    });

    await suite.test("V15: missing scoped service fails before business/guard mutation, no PG/file/fetch fallback", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      const cases: Array<{ method: "POST" | "PATCH"; key: keyof DataRepositories; status?: number }> = [
        ...(["POST", "PATCH"] as const).flatMap(method => [
          { method, key: "omAssignment" as const, status: 500 }, { method, key: "omRequests" as const, status: 500 },
          { method, key: "teamUsers" as const, status: 403 }, { method, key: "requestActivity" as const }
        ]),
        { method: "PATCH", key: "operations", status: 500 },
        { method: "PATCH", key: "omAssignmentCalendar", status: 500 },
        { method: "PATCH", key: "omAssignmentNotifier", status: 500 }
      ];
      for (const entry of cases) {
        const ports: Partial<DataRepositories> = { ...h.scope }; delete ports[entry.key];
        const before = await h.snapshot(), start = h.mutationCount();
        const call = () => h.invoke(entry.method, { id: f.created.id, assignedOm: OM, confirmationToken: p.token }, manager, ports);
        if (entry.key === "requestActivity") await assert.rejects(call(), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
        else await h.expectResponse(await call(), entry.status!);
        assert.deepEqual(await h.snapshot(), before); assert.equal(h.mutationCount(), start, entry.key);
        h.assertEffects([], 0); assertIsolated();
      }
      // Preview requires confirmed service, but not post-commit ports or intake ports.
      const previewOnly: Partial<DataRepositories> = { omAssignment: h.assignment, omRequests: h.repo,
        teamUsers: h.scope.teamUsers, requestActivity: h.scope.requestActivity };
      const before = await h.snapshot(), count = h.mutationCount();
      await h.expectResponse(await h.invoke("POST", { id: f.created.id, assignedOm: OM }, manager, previewOnly), 200);
      assert.deepEqual(await h.snapshot(), before); assert.equal(h.mutationCount(), count);
      // Public confirmed facade delegates to the actual repository in an explicit scope.
      assert.equal((await h.run(() => confirmed.previewOmAssignment(f.created, OM, manager.user.email))).count, 2);
      assertIsolated();
    });

    await suite.test("V14/V17: stale/retargeted token is 409 without changes; fresh preview recovers", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      await h.patch("OperationSession", f.ids[0], { omName: "Synthetic manual assignee", updatedAt: new Date(Date.now() + 1) });
      const before = await h.snapshot();
      for (const assignedOm of [OM, "Synthetic retargeted assignee", null]) {
        await h.expectResponse(await h.confirm(f.created.id, assignedOm, p.token), 409);
        assert.deepEqual(await h.snapshot(), before); h.assertEffects([], 0);
      }
      const fresh = await h.preview(f.created.id, OM);
      await h.expectResponse(await h.confirm(f.created.id, OM, fresh.token), 200);
      h.assertEffects(f.operationIds, 1); assertIsolated();
    });

    await suite.test("V16: all manual name/account values replaced, same-OM round repair, noop replay and cancellation Slack rules", async () => {
      const f = await h.create();
      await h.patch("OperationSession", f.ids[0], { omName: "Synthetic manual round", omUserId: "synthetic-private-account", operationStatus: "DONE" });
      h.arm(f, OM);
      await h.expectResponse(await h.confirm(f.created.id, OM, (await h.preview(f.created.id, OM)).token), 200);
      h.assertEffects(f.operationIds, 1);
      assert.equal((await h.store.one("OperationSession", { _id: f.ids[0] }))?.operationStatus, "DONE");
      await h.patch("OperationSession", f.ids[0], { omName: "Synthetic manual repair", omUserId: "synthetic-manual-account", updatedAt: new Date() });
      h.arm(f, OM, [f.ids[0]]);
      const repair = await h.preview(f.created.id, OM);
      h.assertEffects([], 0);
      await h.expectResponse(await h.confirm(f.created.id, OM, repair.token), 200);
      const repaired = await h.store.one("OperationSession", { _id: f.ids[0] }); assert.ok(repaired);
      h.assertEffects([String(repaired.operationId)], 0);
      assert.equal(repaired.operationStatus, "DONE");
      h.arm(f, OM, []);
      const noop = await h.preview(f.created.id, OM), before = await h.snapshot(false);
      for (let attempt = 0; attempt < 2; attempt++) {
        await h.expectResponse(await h.confirm(f.created.id, OM, noop.token), 200);
        assert.deepEqual(await h.snapshot(false), before, "Only internal restore guard may change on a complete noop");
        h.assertEffects([], 0);
      }
      h.arm(f, null);
      const cancelled = await h.expectResponse(await h.confirm(f.created.id, null, (await h.preview(f.created.id, null)).token), 200);
      assert.equal(Object.hasOwn(cancelled, "assignedOm"), false);
      assert.equal(cancelled.status, "배정필요"); h.assertEffects(f.operationIds, 0);
      const rows = await h.store.scan("OperationSession", { _id: { $in: f.ids } });
      assert.equal(rows.find(row => row.id === f.ids[0])?.operationStatus, "DONE");
      assert.equal(rows.find(row => row.id === f.ids[1])?.operationStatus, "ASSIGNMENT_NEEDED");
      assertIsolated();
    });

    await suite.test("V14/V16: native creation metadata mismatch yields 409 with no partial assignment", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      const creation = await h.store.collection("ActivityChange").findOne({ requestId: f.batch, targetType: "operation_sessions", action: "create" });
      assert.ok(creation);
      await h.store.collection("ActivityChange").deleteOne({ _id: creation._id });
      try {
        const before = await h.snapshot();
        await h.expectResponse(await h.invoke("POST", { id: f.created.id, assignedOm: OM }), 409);
        await h.expectResponse(await h.confirm(f.created.id, OM, p.token), 409);
        assert.deepEqual(await h.snapshot(), before); h.assertEffects([], 0);
      } finally { await h.store.collection("ActivityChange").insertOne(creation); }
      assertIsolated();
    });

    await suite.test("V16: native ActivityChange validator failure aborts business/audit/guard and emits safe 500", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      const before = await h.snapshot(), start = logs.length, commandStart = writes.length;
      await h.withValidator("ActivityChange", { route: { $ne: "/api/om-request/assign" } }, async () => {
        const response = await h.confirm(f.created.id, OM, p.token);
        const body = await h.expectResponse(response, 500);
        assert.deepEqual(body, { error: "배정을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." });
        assert.deepEqual(await h.snapshot(), before, "Rollback includes encrypted bytes, timestamps, existing audits and guard");
        h.assertEffects([], 0);
        assert.equal(await h.store.collection("ActivityChange").countDocuments({ requestId: response.headers.get("X-Request-Id")! }), 0);
      });
      const attempted = writes.slice(commandStart);
      assert.ok(attempted.some(row => row.collection === h.store.collection("OperationSession").collectionName), "Must exercise real business write before failing real audit insertion");
      assert.ok(attempted.some(row => row.collection === h.store.collection("ActivityChange").collectionName && row.command === "insert"));
      assertSafeLogs(start);
      assert.ok(logs.slice(start).some(row => row[0] === "[om-request] 배정 확인 또는 저장 실패"));
      // Rollback leaves original token usable; no retry fake or assignment mock.
      await h.expectResponse(await h.confirm(f.created.id, OM, p.token), 200);
      h.assertEffects(f.operationIds, 1); assertIsolated();
    });

    async function checkInjectedCommit(mode: "transient" | "lost-ack" | "unresolved-ack") {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM);
      const logStart = logs.length;
      const guardName = courseNameRestoreGuardCollection(h.store).collectionName;
      const commands: Array<{ command: string; collection?: string; transaction: string }> = [];
      const checkpoints: Array<{ stage: string; calendar: number; slack: number }> = [];
      const sessions = new Set<ClientSession>();
      let assignmentSession: ClientSession | undefined, assignmentSessionId: string | undefined, observing = true;
      let requestId: string | undefined, commitCalls = 0, nativeCommits = 0, injectedErrors = 0;
      // One real guard write starts each assignment callback. Keep metadata only;
      // no command payload or synthetic private error is sent to console.
      const listener = (event: { databaseName: string; commandName: string; command: Document }) => {
        const context = activityContext.getStore();
        if (context?.route !== "/api/om-request/assign" || context.method !== "PATCH") return;
        if (event.databaseName === databaseName && event.commandName === "update" && event.command.update === guardName) {
          requestId ??= context.requestId;
          assignmentSessionId ??= JSON.stringify(event.command.lsid);
        }
        if (!observing || !requestId || context.requestId !== requestId || event.command.autocommit !== false
          || JSON.stringify(event.command.lsid) !== assignmentSessionId) return;
        const collection = event.command[event.commandName];
        commands.push({ command: event.commandName, collection: typeof collection === "string" ? collection : undefined,
          transaction: String(event.command.txnNumber) });
      };
      const checkpoint = (stage: string) => checkpoints.push({ stage,
        calendar: h.observations.filter(row => row.kind === "calendar").length,
        slack: h.observations.filter(row => row.kind === "slack").length });
      const original = ClientSession.prototype.commitTransaction;
      client.on("commandStarted", listener);
      const fault = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        if (!requestId || activityContext.getStore()?.requestId !== requestId) return original.apply(this, args);
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Pin the exact session object targeted by fault injection.
        if (!assignmentSession && JSON.stringify(this.id) === assignmentSessionId) assignmentSession = this;
        // Post-commit operation/effect reads have their own transactions in the
        // same HTTP context. Faults and evidence concern the assignment only.
        if (this !== assignmentSession) return original.apply(this, args);
        sessions.add(this); commitCalls++;
        checkpoint("before commit attempt");
        if (mode === "transient" && commitCalls === 1) {
          // Real writes have completed. Abort them to model a failed transaction
          // before injecting a label for the REAL driver's callback retry loop.
          // This synthetic code 112 is NOT native server contention evidence.
          await this.abortTransaction();
          checkpoint("after abort, before callback retry");
          injectedErrors++;
          const error = new MongoServerError({ code: 112, message: PRIVATE_ERROR });
          error.addErrorLabel("TransientTransactionError");
          throw error;
        }
        const result = await original.apply(this, args);
        nativeCommits++;
        checkpoint("after native commit, before acknowledgement reaches route");
        if ((mode === "lost-ack" && commitCalls === 1) || mode === "unresolved-ack") {
          injectedErrors++;
          // code 50 models the driver's terminal unknown-result branch without
          // a 30-second spin. This is not a real network loss or budget-expiry test.
          const error = new MongoServerError({ code: mode === "unresolved-ack" ? 50 : 91, message: PRIVATE_ERROR });
          error.addErrorLabel("UnknownTransactionCommitResult");
          throw error;
        }
        observing = false;
        return result;
      });
      let response: Response;
      try { response = await h.confirm(f.created.id, OM, p.token); }
      finally { fault.mock.restore(); client.off("commandStarted", listener); }

      // Assert outside the route's catches: a swallowed assertion must never
      // masquerade as the expected safe HTTP 500 in the unresolved case.
      const unresolved = mode === "unresolved-ack";
      const body = await h.expectResponse(response, unresolved ? 500 : 200);
      assert.ok(requestId); assert.equal(response.headers.get("X-Request-Id"), requestId);
      assert.equal(sessions.size, 1, "Driver retries stay in one repository session");
      assert.equal(injectedErrors, 1);
      assert.equal(commitCalls, unresolved ? 1 : 2);
      assert.equal(nativeCommits, mode === "lost-ack" ? 2 : 1);
      assert.ok(checkpoints.length > 0);
      for (const point of checkpoints) {
        assert.equal(point.calendar, 0, point.stage); assert.equal(point.slack, 0, point.stage);
      }
      const guards = commands.filter(row => row.command === "update" && row.collection === guardName);
      assert.equal(guards.length, mode === "transient" ? 2 : 1, "Guard writes count real assignment callback attempts");
      assert.equal(new Set(guards.map(row => row.transaction)).size, guards.length);
      for (const guard of guards) {
        const attempt = commands.filter(row => row.transaction === guard.transaction);
        assert.equal(attempt.filter(row => row.command === "update" && row.collection === h.store.collection("OmRequest").collectionName).length, 1);
        assert.equal(attempt.filter(row => row.command === "update" && row.collection === h.store.collection("OperationSession").collectionName).length, 2);
        assert.equal(attempt.filter(row => row.command === "insert" && row.collection === h.store.collection("ActivityChange").collectionName).length, 3);
      }
      const wireCommits = commands.filter(row => row.command === "commitTransaction");
      assert.equal(wireCommits.length, nativeCommits, "Native driver must actually submit commit commands");
      assert.equal(new Set(wireCommits.map(row => row.transaction)).size, 1, "Lost ACK retries the same transaction's commit");
      assert.equal(commands.filter(row => row.command === "abortTransaction").length, mode === "transient" ? 1 : 0);

      // ACK loss can occur AFTER commit. Confirm this fixture's persisted data;
      // never compare the raw snapshot to pre-PATCH or claim universal rollback.
      const stored = await h.repo.getOmRequest(f.created.id);
      assert.equal(stored?.assignedOm, OM); assert.equal(stored?.status, "배정완료");
      const rounds = await h.store.scan("OperationSession", { _id: { $in: f.ids } });
      assert.equal(rounds.length, 2);
      for (const round of rounds) { assert.equal(round.omName, OM); assert.equal(round.omUserId, null); }
      const audits = await h.store.scan("ActivityChange", { requestId });
      assert.deepEqual(audits.map(row => row.targetId).sort(), [...f.ids, f.created.id].sort());
      assert.ok(audits.every(row => row.actorEmail === manager.user.email && row.method === "PATCH" && row.route === "/api/om-request/assign"));
      h.assertEffects(unresolved ? [] : f.operationIds, unresolved ? 0 : 1);
      assertSafeLogs(logStart);
      if (unresolved) {
        assert.deepEqual(body, { error: "배정을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." });
        assert.deepEqual(logs.slice(logStart), [["[om-request] 배정 확인 또는 저장 실패"]]);
      } else {
        assert.equal(body.assignedOm, OM);
        assert.deepEqual(logs.slice(logStart), []);
      }
      assertIsolated();
    }

    await suite.test("V16: actual PATCH injected transient commit error retries callback; effects stay zero until success and occur once", async () => {
      await checkInjectedCommit("transient");
    });
    await suite.test("V16: actual PATCH injected lost commit ACK retries driver commit with one callback and no duplicate effects", async () => {
      await checkInjectedCommit("lost-ack");
    });
    await suite.test("V16: actual PATCH injected unresolved commit ACK returns safe 500, private-free logs and zero effects without claiming rollback", async () => {
      await checkInjectedCommit("unresolved-ack");
    });

    await suite.test("V16: each failed calendar call continues; Slack failure does not undo commit or expose exceptions", async () => {
      for (const fail of [{ calendar: true, slack: false }, { calendar: false, slack: true }, { calendar: true, slack: true }]) {
        const f = await h.create(), p = await h.preview(f.created.id, OM);
        h.arm(f, OM); h.control.failCalendar = fail.calendar; h.control.failSlack = fail.slack;
        const start = logs.length;
        try {
          const response = await h.confirm(f.created.id, OM, p.token);
          const body = await h.expectResponse(response, 200);
          assert.equal(body.assignedOm, OM); assert.equal((await h.repo.getOmRequest(f.created.id))?.assignedOm, OM);
          h.assertEffects(f.operationIds, 1);
          assertSafeLogs(start);
          const messages = logs.slice(start).map(row => row[0]);
          assert.equal(messages.filter(value => value === "[om-request] 배정 저장 후 캘린더 반영 실패").length, fail.calendar ? 2 : 0);
          // Match the fixed message in the current assignment route; never log exception arguments.
          assert.equal(messages.filter(value => value === "[om-request] Slack 배정 알림 실패(무시)").length, fail.slack ? 1 : 0);
        } finally { h.control.failCalendar = false; h.control.failSlack = false; }
      }
      assertIsolated();
    });

    await suite.test("V12: actual HTTP retention may remove expired creation evidence after a read-only preview", async () => {
      const f = await h.create();
      const filter = { requestId: f.batch, action: "create", targetType: { $in: ["om_requests", "operation_sessions"] } };
      await h.store.collection("ActivityChange").updateMany(filter, { $set: { occurredAt: new Date("2000-01-01T00:00:00.000Z") } });
      const before = await h.snapshot(), oldIds = (await h.store.collection("ActivityChange").find(filter).toArray()).map(row => row._id);
      assert.equal(oldIds.length, 3);
      const ports = { ...h.scope, requestActivity: await MongoRequestAuditRepository.open(h.options) };
      const body = await h.expectResponse(await h.invoke("POST", { id: f.created.id, assignedOm: OM }, manager, ports), 200);
      assert.equal(await h.store.collection("ActivityChange").countDocuments({ _id: { $in: oldIds } }), 0);
      const after = await h.snapshot();
      const withoutChanges = (snapshot: typeof before) => snapshot.filter(([name]) => name !== h.store.collection("ActivityChange").collectionName);
      assert.deepEqual(withoutChanges(after), withoutChanges(before), "retention does not mutate business or guard");
      await h.expectResponse(await h.confirm(f.created.id, OM, (body.preview as Preview).token), 409);
      assert.deepEqual(await h.snapshot(), after); assertIsolated();
    });
    await suite.test("V16: real late HTTP log failure preserves committed business + audit and 200 no-store", async () => {
      const f = await h.create(), p = await h.preview(f.created.id, OM);
      h.arm(f, OM); const start = logs.length;
      await h.withValidator("ActivityRequest", { status: { $lt: 0 } }, async () => {
        const response = await h.confirm(f.created.id, OM, p.token);
        assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        assert.equal((await response.json()).assignedOm, OM);
        assert.equal(await h.store.collection("ActivityRequest").countDocuments({ _id: requestId }), 0);
        assert.equal(await h.store.collection("ActivityChange").countDocuments({ requestId }), 3);
        assert.equal((await h.repo.getOmRequest(f.created.id))?.assignedOm, OM);
        h.assertEffects(f.operationIds, 1);
      });
      assertSafeLogs(start);
      assert.deepEqual(logs.slice(start), [["[activity] API request log write failed"]]); assertIsolated();
    });

    await suite.test("V15: only confirmed services are enabled; both legacy helpers remain explicitly blocked", async () => {
      const f = await h.create(), before = await h.snapshot(), count = h.mutationCount();
      await h.run(async () => {
        await assert.rejects(updateOmRequestAssignment(f.created.id, OM), /OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED/);
        await assert.rejects(syncAssignedOmToLinkedOperation(f.created.operationId!, OM), /OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED/);
      });
      assert.deepEqual(await h.snapshot(), before); assert.equal(h.mutationCount(), count);
      assertIsolated();
    });

    await suite.test("V15: native independent/nested scopes isolate repository, auth, activity and external ports", async () => {
      const b = await makeHarness("shadow_assignment_inner");
      const [fa, fb] = await Promise.all([h.create(), b.create()]);
      const [pa, pb] = await Promise.all([h.preview(fa.created.id, OM), b.preview(fb.created.id, "Synthetic inner assignee")]);
      await h.run(async () => {
        assert.equal(getDataRepositoryOverride("omAssignment"), h.assignment);
        const outerActor = actors.getStore();
        await b.run(async () => {
          assert.equal(actors.getStore(), other);
          assert.equal(getDataRepositoryOverride("omAssignment"), b.assignment);
          await b.expectResponse(await b.invoke("POST", { id: fa.created.id, assignedOm: OM }), 404);
          // Missing inner ports MUST NOT merge with outer context.
          await assert.rejects(runWithDataRepositories({}, () => assignmentRoute.POST(request("POST", { id: fb.created.id, assignedOm: OM }))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
          const incomplete: Partial<DataRepositories> = { ...b.scope }; delete incomplete.omAssignment;
          await b.expectResponse(await b.invoke("POST", { id: fb.created.id, assignedOm: OM }, manager, incomplete), 500);
        }, other);
        assert.equal(actors.getStore(), outerActor);
        assert.equal(getDataRepositoryOverride("omAssignment"), h.assignment);
        await h.expectResponse(await h.invoke("POST", { id: fb.created.id, assignedOm: OM }), 404);
      });
      assert.equal(actors.getStore(), undefined);
      assert.equal(getDataRepositoryOverride("omAssignment"), undefined);
      h.arm(fa, OM); b.arm(fb, "Synthetic inner assignee");
      const [ra, rb] = await Promise.all([h.confirm(fa.created.id, OM, pa.token), b.confirm(fb.created.id, "Synthetic inner assignee", pb.token)]);
      await h.expectResponse(ra, 200); await b.expectResponse(rb, 200);
      h.assertEffects(fa.operationIds, 1); b.assertEffects(fb.operationIds, 1);
      assert.notEqual(ra.headers.get("X-Request-Id"), rb.headers.get("X-Request-Id"));
      assert.equal(await h.store.collection("ActivityChange").countDocuments({ requestId: rb.headers.get("X-Request-Id")! }), 0);
      assert.equal(await b.store.collection("ActivityChange").countDocuments({ requestId: ra.headers.get("X-Request-Id")! }), 0);
      assert.equal(await h.repo.getOmRequest(fb.created.id), null); assert.equal(await b.repo.getOmRequest(fa.created.id), null);
      assertIsolated();
    });
    assertIsolated();
  } finally {
    hooks.deregister();
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally {
        for (const restore of restores.reverse()) restore();
        syncBuiltinESMExports();
        for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    }
  }
});
