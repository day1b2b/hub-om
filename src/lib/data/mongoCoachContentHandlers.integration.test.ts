import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { MongoClient } from "mongodb";
import { MongoCoachContentRepository, prepareMongoCoachContentStore, COACH_CONTENT_MODELS } from "./mongoCoachContentRepository";
import { MongoCoachAdminRepository, prepareMongoCoachAdminStore } from "./mongoCoachAdminRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const manager: Session = { user: { email: "content-manager@day1company.co.kr", name: "Synthetic content manager" }, expires: "" };
const admin: Session = { user: { email: "content-admin@day1company.co.kr", name: "Synthetic content admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG access"); } } });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/coaches/CoachAdminPage") return { url: "data:text/javascript,export const CoachAdminPage = () => null;", shortCircuit: true };
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const notes = await import("../../app/api/coaches/[id]/notes/route");
const note = await import("../../app/api/coaches/[id]/notes/[noteId]/route");
const feed = await import("../../app/api/admin/content-entries/route");
const registration = await import("../../app/api/admin/schedule-registration/[yearMonth]/route");
const status = await import("../../app/api/schedules/[yearMonth]/status/route");
const { default: page } = await import("../../app/coaches/admin/page");
hook.deregister();
const uri = process.env.MONGODB_COACH_CONTENT_TEST_URI;
const request = (method = "GET", body?: unknown) => new Request("https://example.invalid/api/content", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

test("native Mongo content routes retain real authorization, request audit and admin page boundaries", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!); assert.equal(url.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.ok(url.port); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.ok(url.pathname === "" || url.pathname === "/");
  const names = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL", "DEV_AUTH_BYPASS", "ADMIN_EMAILS", "SKILLFLO_COACH_URL_TEMPLATE"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); process.env.PII_ACTIVE_KEY_ID = "fixture"; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64"); process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  process.env.ADMIN_EMAILS = admin.user.email; delete process.env.DEV_AUTH_BYPASS; delete process.env.DATABASE_URL;
  process.env.SKILLFLO_COACH_URL_TEMPLATE = "https://example.invalid/input/{token}";
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 }), databaseName = `hub_om_shadow_content_handlers_${randomBytes(8).toString("hex")}`;
  let connected = false;
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("External source forbidden"); });
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_handlers", allowShadowWrites: true as const };
    await prepareMongoCoachContentStore(options); await prepareMongoCoachAdminStore(options); await prepareMongoRequestAuditStore(options);
    const store = new MongoOperationStore(options, [...new Set([...COACH_CONTENT_MODELS, ...REQUEST_AUDIT_MODELS])]);
    const scope = { coachContent: await MongoCoachContentRepository.open(options), coachAdmin: await MongoCoachAdminRepository.open(options), requestActivity: await MongoRequestAuditRepository.open(options) };
    const run = <T>(work: () => Promise<T>, actor: Session | null = manager) => runWithDataRepositories(scope, () => actors.run(actor, work));
    const seed = async (model: string, fields: MongoRow) => { const row = coachFixtureRow(model, fields); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const a = await seed("Coach", { name: "합성 가 코치", normalizedName: "가", status: "ACTIVE", isActive: false, accessToken: "synthetic-token/+" });
    const b = await seed("Coach", { name: "합성 나 코치", normalizedName: "나", status: "ACTIVE" });
    const c = await seed("Coach", { name: "합성 다 코치", normalizedName: "다", status: "ACTIVE" });
    await seed("Coach", { name: "합성 삭제 코치", normalizedName: "삭제", status: "ACTIVE", deletedAt: new Date() });
    await seed("Coach", { name: "합성 휴면 코치", normalizedName: "휴면", status: "INACTIVE" });
    await seed("CoachScheduleAccessLog", { coachId: a.id, yearMonth: "2099-12", lastEditedAt: new Date("2099-12-01") });
    await seed("CoachScheduleAccessLog", { coachId: b.id, yearMonth: "2099-12", lastEditedAt: null });
    const params = { params: Promise.resolve({ id: a.id as string }) };
    let noteId = "";
    await suite.test("actual handlers preserve trimmed content, DTOs, warning precedence and soft deletion", async () => {
      assert.equal((await run(() => notes.POST(request("POST", { content: " " }), params))).status, 400);
      const response = await run(() => notes.POST(request("POST", { content: "  합성 비공개 메모  " }), params));
      assert.equal(response.status, 200); assert.ok(response.headers.get("X-Request-Id"));
      const created = (await response.json()).note; noteId = created.id;
      assert.equal(created.content, "합성 비공개 메모"); assert.equal(created.authorEmail, manager.user.email);
      assert.deepEqual(Object.keys(created).sort(), ["id", "coachId", "kind", "content", "authorEmail", "authorName", "sourceField", "flaggedAt", "createdAt", "updatedAt", "deletedAt"].sort());
      const listed = (await (await run(() => notes.GET(request(), params))).json()).notes;
      assert.deepEqual(Object.keys(listed[0]).sort(), ["id", "content", "authorName", "flaggedAt", "createdAt"].sort());
      const detail = { params: Promise.resolve({ id: a.id as string, noteId }) };
      const toggled = (await (await run(() => note.PATCH(request("PATCH", { toggleWarn: true, content: "ignored" }), detail))).json()).note;
      assert.ok(toggled.flaggedAt); assert.equal(toggled.content, created.content);
      const updated = (await (await run(() => note.PATCH(request("PATCH", { content: " 합성 수정 " }), detail), admin)).json()).note;
      assert.equal(updated.content, "합성 수정"); assert.equal(updated.authorEmail, manager.user.email);
      const changes = (await store.scan("ActivityChange")).filter(row => row.targetId === noteId);
      assert.equal(changes.length, 3); assert.ok(changes.every(row => row.requestId));
      for (const change of changes) assert.equal(await store.collection("ActivityRequest").countDocuments({ _id: change.requestId as string }), 1);
      assert.deepEqual(await (await run(() => note.DELETE(request("DELETE"), detail))).json(), { ok: true });
      assert.deepEqual((await (await run(() => notes.GET(request(), params))).json()).notes, []);
      assert.ok((await store.one("CoachContentEntry", { _id: noteId }))?.deletedAt);
    });
    await suite.test("workspace access is enforced and missing service/audit scope cannot fall back to PostgreSQL", async () => {
      const before = await store.collection("CoachContentEntry").countDocuments();
      for (const actor of [null, { user: { email: "outsider@example.invalid", name: "Synthetic outsider" }, expires: "" }]) {
        await assert.rejects(run(() => notes.POST(request("POST", { content: "denied" }), params), actor), /NEXT_REDIRECT/);
        await assert.rejects(run(() => feed.GET(), actor), /NEXT_REDIRECT/);
      }
      await assert.rejects(runWithDataRepositories({ coachContent: scope.coachContent }, () => actors.run(manager, () => notes.POST(request("POST", { content: "denied" }), params))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      await assert.rejects(runWithDataRepositories({ requestActivity: scope.requestActivity }, () => actors.run(manager, () => notes.POST(request("POST", { content: "denied" }), params))), /DATA_REPOSITORY_NOT_CONFIGURED: coachContent/);
      assert.equal(await store.collection("CoachContentEntry").countDocuments(), before); assert.equal(pgCalls, 0);
    });
    await suite.test("both month handlers use access logs, keep distinct DTOs and reject invalid months", async () => {
      const month = { params: Promise.resolve({ yearMonth: "2099-12" }) };
      const registered = await (await run(() => registration.GET(request(), month))).json();
      assert.deepEqual(registered.counts, { completed: 1, accessedOnly: 1, notAccessed: 1, total: 3 });
      assert.deepEqual(registered.coaches.map((row: { id: string }) => row.id), [a.id, b.id, c.id]);
      assert.equal(registered.coaches[0].coachInputUrl, "https://example.invalid/input/synthetic-token%2F%2B");
      const states = await (await run(() => status.GET(request(), month))).json();
      assert.ok(!JSON.stringify(states).includes("synthetic-token"));
      for (const route of [registration, status]) assert.equal((await run(() => route.GET(request(), { params: Promise.resolve({ yearMonth: "2099-13" }) }))).status, 400);
      assert.equal((await run(() => registration.GET(request(), { params: Promise.resolve({ yearMonth: "0000-01" }) }))).status, 200);
    });
    await suite.test("admin page checks auth before DB, redirects content before count and renders injected count/tab", async () => {
      const render = (tab?: string | string[]) => page({ searchParams: Promise.resolve({ tab }) });
      await assert.rejects(run(() => render(), manager), /NEXT_REDIRECT/);
      await assert.rejects(runWithDataRepositories({}, () => actors.run(admin, () => render("content"))), /NEXT_REDIRECT/);
      const output = await run(() => render(["deleted", "sync"]), admin);
      assert.equal(output.props.deletedCount, 1); assert.equal(output.props.selectedTab, "deleted");
      assert.equal((await run(() => render("unknown"), admin)).props.selectedTab, "schedule-link");
      await assert.rejects(runWithDataRepositories({}, () => actors.run(admin, () => render())), /DATA_REPOSITORY_NOT_CONFIGURED: coachAdmin/);
    });
    await suite.test("request audit failure preserves business success and emits only a fixed safe error", async () => {
      const messages: unknown[][] = [], patch = mock.method(console, "error", (...values: unknown[]) => { messages.push(values); });
      try {
        const response = await runWithDataRepositories({ ...scope, requestActivity: { recordRequest: async () => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); } } }, () => actors.run(manager, () => notes.POST(request("POST", { content: "합성 감사 장애 성공" }), params)));
        assert.equal(response.status, 200); const id = (await response.json()).note.id;
        assert.ok(await store.one("CoachContentEntry", { _id: id }));
        assert.deepEqual(messages, [["[activity] API request log write failed"]]); assert.equal(pgCalls, 0);
      } finally { patch.mock.restore(); }
    });
    const raw = JSON.stringify(await Promise.all(store.models.map(model => store.collection(model).find({}).toArray())));
    for (const value of ["합성 비공개 메모", "합성 수정", manager.user.email, manager.user.name, "합성 가 코치", "synthetic-token/+"]) assert.ok(!raw.includes(value), `storage exposed synthetic marker: ${value}`);
    assert.equal(external.mock.callCount(), 0); assert.equal(pgCalls, 0);
  } finally {
    if (connected) await client.db(databaseName).dropDatabase(); await client.close(); external.mock.restore();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
