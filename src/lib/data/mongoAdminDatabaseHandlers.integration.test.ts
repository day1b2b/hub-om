/** Actual guards, request auditing and page composition; native DB execution belongs to main.
 * Run only with explicit MONGODB_ADMIN_DATABASE_TEST_URI pointing at a local replica set.
 * UI components and the session supplier are stubs; auth/route/page/repositories are real.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode, type ReactElement } from "react";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { ADMIN_DATABASE_MODELS, MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, operationMongoValidator, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { DatabaseTableSnapshot } from "../admin/databaseDashboard";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "database-admin@day1company.co.kr", name: "Synthetic private administrator" }, expires: "" };
const member: Session = { user: { email: "database-member@day1company.co.kr", name: "Synthetic member" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0, localCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
mock.module("./localJsonTeamMemberRepository", { namedExports: { LocalJsonTeamMemberRepository: class {
  constructor() { localCalls++; throw new Error("Unexpected local roster access"); }
} } });
const ui = new Map<string, string>([
  ["@/components/AppSidebar", "AppSidebar"],
  ...["AdminDatabaseGrid", "CourseDeletePanel", "DeletedOperationsPanel", "OmAssignmentStatusBackfillPanel", "OnsiteRequiredBackfillPanel"]
    .map(name => [`@/features/admin/${name}`, name] as const)
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    // Keep the actual stored factory; its unused external reader must never load.
    if (specifier === "./notionTeamMemberRepository") return { url: "data:text/javascript,export function getNotionTeamMemberRepository(){throw new Error('Unexpected external reader')}", shortCircuit: true };
    const name = ui.get(specifier);
    if (name) return { url: `data:text/javascript,export function ${name}(){return null;}`, shortCircuit: true };
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const { PATCH } = await import("../../app/api/admin/database/cell/route");
const { default: page } = await import("../../app/admin/database/page");
hooks.deregister();

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function component(node: ReactNode, name: string) {
  const matches = elements(node).filter(element => typeof element.type === "function" && element.type.name === name);
  assert.equal(matches.length, 1, `Expected one ${name}`);
  return matches[0];
}
function panelNames(node: ReactNode) {
  return elements(node).flatMap(element => typeof element.type === "function" && element.type.name.endsWith("Panel") ? [element.type.name] : []).sort();
}
const request = (body: unknown) => new Request("https://example.invalid/api/admin/database/cell", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});
const body = (table: string, rowId: string, field: string, value: unknown) => ({ table, rowId, field, value });
const uri = process.env.MONGODB_ADMIN_DATABASE_TEST_URI;

test("admin database actual PATCH and page use native Mongo with real authorization and request audit", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL", "OPERATION_DATA_SOURCE"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const databaseName = `hub_om_shadow_admin_handlers_${randomBytes(8).toString("hex")}`;
  Object.assign(process.env, {
    PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email,
    OPERATION_DATA_SOURCE: "local"
  });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  let connected = false;
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_handlers", allowShadowWrites: true as const };
    await prepareMongoAdminDatabaseStore(options);
    await prepareMongoReadStore(options, TEAM_READ_MODELS);
    await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...ADMIN_DATABASE_MODELS, ...TEAM_READ_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = {
      adminDatabase: await MongoAdminDatabaseRepository.open(options),
      teamMembers: await MongoTeamMemberRepository.open(options),
      requestActivity: await MongoRequestAuditRepository.open(options)
    };
    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const patch = (value: unknown) => run(() => PATCH(request(value)));
    const render = (table?: string | string[]) => run(() => page({ searchParams: Promise.resolve({ table }) }));
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, { id: randomUUID(), ...values });
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row.id as string;
    };
    const company = await seed("Company", { name: "Synthetic first company", normalizedName: "synthetic first company" });
    await seed("Company", { name: "Synthetic occupied company", normalizedName: "synthetic occupied company" });
    const course = await seed("Course", { companyId: company, processSeq: 71, courseId: "SYN-71", name: "Synthetic course", revenue: "0" });
    const person = await seed("Member", { name: "Synthetic private owner", normalizedName: "synthetic private owner", role: null, sourceTeam: "TEAM_1", isActive: true, displayOrder: null });
    const operation = await seed("OperationSession", { courseRecordId: course, operationId: "synthetic-admin-operation", onsiteRequired: "N", onsiteText: "preserved onsite", deletedAt: new Date("2099-01-01"), deletedBy: "synthetic-deleter@example.invalid" });
    const rawBusiness = async () => Promise.all(["Company", "Course", "Member", "OperationSession"].map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()]));

    await suite.test("real admin guard rejects anonymous, outsider and workspace-only sessions before writes/page reads", async () => {
      const before = await rawBusiness();
      for (const actor of [null, member, { user: { email: "outside@example.invalid", name: "Outsider" }, expires: "" }]) {
        await assert.rejects(run(() => PATCH(request(body("companies", company, "name", "denied"))), actor), /NEXT_REDIRECT/);
        await assert.rejects(runWithDataRepositories({}, () => actors.run(actor, () => page({ searchParams: Promise.resolve({}) }))), /NEXT_REDIRECT/);
      }
      assert.deepEqual(await rawBusiness(), before);
    });

    await suite.test("real parser retains malformed JSON 400, JSON null exception and readonly 403 without writes", async () => {
      const before = await rawBusiness();
      assert.equal((await run(() => PATCH(new Request("https://example.invalid", { method: "PATCH", body: "{" })))).status, 400);
      await assert.rejects(patch(null), TypeError);
      for (const value of [[], {}, { table: 1, rowId: person, field: "name" },
        body("companies", company, "name", " "), body("members", person, "isActive", "1"),
        body("members", person, "role", "INVALID"), body("members", person, "displayOrder", "1.5"),
        body("courses", course, "revenue", "Infinity"), body("operation_sessions", operation, "startDate", "not-a-date")]) {
        assert.equal((await patch(value)).status, 400);
      }
      for (const value of [body("unknown", company, "name", "x"), body("companies", company, "normalizedName", "x"), body("operation_sessions", operation, "deletedAt", null)]) {
        const response = await patch(value); assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { ok: false, error: "이 항목은 읽기 전용입니다." });
      }
      assert.deepEqual(await rawBusiness(), before);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    });

    await suite.test("boolean, enum, nullable integer, money, date and text parsing reach actual Mongo", async () => {
      const cases: Array<[string, string, string, unknown, unknown]> = [
        ["members", person, "isActive", " false ", false], ["members", person, "isActive", true, true],
        ["members", person, "role", " LD ", "LD"], ["members", person, "role", " ", null],
        ["members", person, "displayOrder", "-2", -2], ["members", person, "displayOrder", "1e2", 100],
        ["members", person, "displayOrder", "", null], ["courses", course, "revenue", "1,234.50", "1234.5"],
        ["courses", course, "revenue", "1.005", "1.01"], ["courses", course, "revenue", "-1.005", "-1.01"],
        ["courses", course, "revenue", " ", null], ["operation_sessions", operation, "startDate", "2026-02-30", new Date("2026-03-02T00:00:00Z")],
        ["operation_sessions", operation, "onsiteRequired", "Y", "Y"],
        ["operation_sessions", operation, "specialNotes", "  Synthetic private note  ", "Synthetic private note"]
      ];
      const models: Record<string, string> = { members: "Member", courses: "Course", operation_sessions: "OperationSession" };
      for (const [table, id, field, input, expected] of cases) {
        const response = await patch(body(table, id, field, input)); assert.equal(response.status, 200, `${table}.${field}`);
        assert.deepEqual(await response.json(), { ok: true });
        const row = await store.one(models[table], { _id: id }); assert.ok(row);
        if (field === "revenue" && expected !== null) assert.equal(Number(String(row[field])), Number(expected));
        else assert.deepEqual(row[field], expected);
      }
      const row = await store.one("OperationSession", { _id: operation });
      assert.equal(row?.onsiteText, "preserved onsite"); assert.ok(row?.deletedAt);
      assert.equal(row?.updatedBy, admin.user.email);
    });

    await suite.test("all four UUID PKs accept aliases and distinguish absent, invalid, schema and unique errors", async () => {
      const cases = [["companies", company, "name", "Synthetic alias company"], ["courses", course, "name", "Synthetic alias course"],
        ["members", person, "name", "Synthetic alias owner"], ["operation_sessions", operation, "roundNo", "alias-round"]];
      for (const [table, id, field, value] of cases) {
        for (const alias of [id.toUpperCase(), id.replaceAll("-", ""), `{${id}}`, id.replaceAll("-", "").match(/.{4}/g)!.join("-")]) {
          assert.equal((await patch(body(table, alias, field, value))).status, 200);
        }
        assert.equal((await patch(body(table, randomUUID(), field, value))).status, 404);
        assert.equal((await patch(body(table, "not-a-uuid", field, value))).status, 500);
      }
      assert.equal((await patch(body("members", person, "displayOrder", "2147483648"))).status, 500);
      assert.equal((await patch(body("courses", course, "revenue", "1000000000000"))).status, 500);
      assert.equal((await patch(body("courses", course, "courseId", ""))).status, 500);
      const before = await rawBusiness();
      const conflict = await patch(body("companies", company, "name", "Synthetic occupied company"));
      assert.equal(conflict.status, 409); assert.match((await conflict.json()).error, /Synthetic occupied company/);
      assert.deepEqual(await rawBusiness(), before);
    });

    await suite.test("actual wrapper records encrypted actor and redacted PII under the response request ID", async () => {
      const secret = "Synthetic private handler payload";
      const response = await patch(body("operation_sessions", operation, "specialNotes", secret));
      assert.equal(response.status, 200);
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const changes = await store.scan("ActivityChange", { requestId }); assert.equal(changes.length, 1);
      assert.equal(changes[0].actorEmail, admin.user.email); assert.equal(changes[0].actorName, admin.user.name);
      assert.equal(changes[0].targetId, operation);
      assert.deepEqual((changes[0].changes as Record<string, unknown>).special_notes, { redacted: true });
      const requestRow = await store.one("ActivityRequest", { _id: requestId });
      assert.equal(requestRow?.status, 200); assert.equal(requestRow?.actorEmail, admin.user.email);
      const raw = await store.collection("OperationSession").findOne({ _id: operation }); assert.ok(raw);
      assert.equal(raw.specialNotesPiiIndex, mongoRuntimeBlindIndex("OperationSession", "specialNotes", secret));
      const stored = JSON.stringify([raw, await store.collection("ActivityChange").find({ requestId }).toArray(), await store.collection("ActivityRequest").findOne({ _id: requestId })]);
      for (const privateValue of [secret, admin.user.email, admin.user.name]) assert.ok(!stored.includes(privateValue));
    });

    await suite.test("missing business/request repositories fail before writes and never use PG/local", async () => {
      const before = await rawBusiness();
      await assert.rejects(runWithDataRepositories({ adminDatabase: scope.adminDatabase }, () => actors.run(admin, () => PATCH(request(body("companies", company, "name", "denied"))))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(admin, () => PATCH(request(body("companies", company, "name", "denied"))))), /DATA_REPOSITORY_NOT_CONFIGURED: adminDatabase/);
      assert.deepEqual(await rawBusiness(), before); assert.equal(pgCalls, 0); assert.equal(localCalls, 0);
    });

    await suite.test("late ActivityChange validator failure returns safe 500 and rolls back the complete cell write", async () => {
      const before = await rawBusiness(), count = await store.collection("ActivityChange").countDocuments();
      const audit = store.collection("ActivityChange");
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { action: { $ne: "update" } }] } });
      try {
        const response = await patch(body("operation_sessions", operation, "specialNotes", "Synthetic rollback secret"));
        assert.equal(response.status, 500); assert.deepEqual(await response.json(), { ok: false, error: "저장하지 못했습니다. 특이사항 값을 확인해 주세요." });
      } finally { await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityChange") }); }
      assert.deepEqual(await rawBusiness(), before); assert.equal(await audit.countDocuments(), count);
    });

    await suite.test("actual ActivityRequest write failure leaves business success intact with fixed logging", async () => {
      const audit = store.collection("ActivityRequest"), logs: unknown[][] = [];
      const logger = mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      try {
        const response = await patch(body("operation_sessions", operation, "roundNo", "request-log-failure"));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
        assert.equal((await store.one("OperationSession", { _id: operation }))?.roundNo, "request-log-failure");
        assert.equal(await audit.countDocuments({ _id: response.headers.get("X-Request-Id")! }), 0);
        assert.deepEqual(logs, [["[activity] API request log write failed"]]);
      } finally {
        logger.mock.restore();
        await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityRequest") });
      }
    });

    await suite.test("actual page uses real Mongo resource owners, correct table props and conditional panels", async () => {
      const owners = await scope.teamMembers.listResourceOwners(); assert.deepEqual(owners, { "1팀": ["Synthetic alias owner"] });
      const spy = mock.method(scope.teamMembers, "listResourceOwners");
      try {
        for (const [table, expected, panels] of [
          [undefined, "operation_sessions", ["DeletedOperationsPanel", "OmAssignmentStatusBackfillPanel", "OnsiteRequiredBackfillPanel"]],
          [["courses", "members"], "courses", ["CourseDeletePanel"]],
          ["not-a-table", "operation_sessions", ["DeletedOperationsPanel", "OmAssignmentStatusBackfillPanel", "OnsiteRequiredBackfillPanel"]],
          ["members", "members", []]
        ] as const) {
          const output = await render(typeof table === "string" || table === undefined ? table : [...table]);
          const grid = component(output, "AdminDatabaseGrid");
          const selected = grid.props.selectedTable as DatabaseTableSnapshot;
          assert.equal(selected.key, expected); assert.equal((grid.props.tables as DatabaseTableSnapshot[]).length, 8);
          assert.deepEqual(grid.props.columns, [...new Set(selected.rows.flatMap(row => row.cells.map(cell => cell.label)))]);
          assert.equal(grid.props.teamScope, "both"); assert.deepEqual(panelNames(output), [...panels].sort());
        }
        assert.equal(spy.mock.callCount(), 4);
      } finally { spy.mock.restore(); }
      for (const partial of [{ adminDatabase: scope.adminDatabase }, { teamMembers: scope.teamMembers }]) {
        await assert.rejects(runWithDataRepositories(partial, () => actors.run(admin, () => page({ searchParams: Promise.resolve({}) }))), /DATA_REPOSITORY_NOT_CONFIGURED: (teamMembers|adminDatabase)/);
      }
      assert.equal(pgCalls, 0); assert.equal(localCalls, 0);
    });

    await suite.test("actual page with empty native collections preserves empty Grid props and real team lookup", async () => {
      const emptyOptions = { ...options, namespace: "shadow_empty_page" };
      await prepareMongoAdminDatabaseStore(emptyOptions); await prepareMongoReadStore(emptyOptions, TEAM_READ_MODELS);
      const emptyScope = { adminDatabase: await MongoAdminDatabaseRepository.open(emptyOptions), teamMembers: await MongoTeamMemberRepository.open(emptyOptions) };
      const spy = mock.method(emptyScope.teamMembers, "listResourceOwners");
      try {
        const output = await runWithDataRepositories(emptyScope, () => actors.run(admin, () => page({ searchParams: Promise.resolve({ table: ["members", "courses"] }) })));
        const grid = component(output, "AdminDatabaseGrid");
        assert.deepEqual(grid.props.columns, []);
        assert.equal((grid.props.selectedTable as DatabaseTableSnapshot).key, "members");
        for (const table of grid.props.tables as DatabaseTableSnapshot[]) { assert.equal(table.rowCount, 0); assert.deepEqual(table.rows, []); assert.equal(table.latestActivity, ""); }
        assert.deepEqual(panelNames(output), []); assert.equal(spy.mock.callCount(), 1);
      } finally { spy.mock.restore(); }
    });
    assert.equal(pgCalls, 0); assert.equal(localCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally { external.mock.restore(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    }
  }
});
