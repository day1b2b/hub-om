/** Actual GET/POST, real auth/withActivity/facade/factory and native shadow storage.
 * DB execution belongs to main. Source pages are synthetic; external fetch is forbidden.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoRequestAuditRepository, REQUEST_AUDIT_MODELS, prepareMongoRequestAuditStore } from "./mongoRequestAuditRepository";
import { prepareMongoReadStore } from "./mongoReadStore";
import { MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { JsonObject } from "../instructors/notionInstructorMap";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "instructor-admin@day1company.co.kr", name: "Synthetic private admin" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PG fallback"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const { GET, POST } = await import("../../app/api/admin/sync-notion-instructors/route");
hooks.deregister();
const uri = process.env.MONGODB_INSTRUCTOR_NOTION_TEST_URI;
const rt = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
function page(no: number, name = `Synthetic instructor ${no}`): JsonObject {
  return { id: "aabbccdd-1122-3344-5566-778899aabbcc", properties: {
    "강사명": { type: "title", title: [{ plain_text: name }] }, "ID": { type: "unique_id", unique_id: { number: no } },
    "섭외지양 여부": { type: "checkbox", checkbox: false }, "메모": rt("Contact synthetic-person@example.invalid 010-1234-5678"),
    "이메일 주소": { type: "email", email: "synthetic-person@example.invalid" }, "생년월일": rt("2000-01-02")
  } };
}
function request(method: "GET" | "POST", authorization?: string) {
  return new Request("https://example.invalid/api/admin/sync-notion-instructors", { method, headers: authorization === undefined ? {} : { authorization } });
}
async function fixedError(response: Response, code: string) {
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { ok: false, error: code });
}

test("instructor Notion actual handlers preserve guards, preview, partial writes and audit boundaries", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL", "SYNC_API_SECRET"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const secret = randomBytes(24).toString("hex");
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email, SYNC_API_SECRET: secret });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const databaseName = `hub_om_shadow_instructor_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external fetch"); });
  const errorCapture = mock.method(console, "error", () => {});
  let connected = false;
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_handlers", allowShadowWrites: true as const };
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS); await prepareMongoRequestAuditStore(options);
    const repository = await MongoInstructorNoteRepository.open(options);
    const requestActivity = await MongoRequestAuditRepository.open(options);
    const store = new MongoOperationStore(options, [...new Set([...INSTRUCTOR_NOTE_MODELS, ...REQUEST_AUDIT_MODELS])]);
    let pages: JsonObject[] = [], sourceCalls = 0;
    let sourceError: Error | undefined;
    const source = { readPages: async () => { sourceCalls++; if (sourceError) throw sourceError; return pages; } };
    const scope = { instructorNotionSync: repository, instructorNotionSource: source, requestActivity };
    const invoke = (method: "GET" | "POST", authorization?: string, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, () => (method === "GET" ? GET : POST)(request(method, authorization))));
    const business = async () => {
      const names = (await store.db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).filter(name => name !== store.collection("ActivityRequest").collectionName).sort();
      const rows = [];
      for (const name of names) rows.push([name, await store.db.collection(name).find({}).sort({ _id: 1 }).toArray()]);
      return rows;
    };
    const requestRow = async (response: Response) => {
      const id = response.headers.get("X-Request-Id"); assert.ok(id);
      const row = await store.one("ActivityRequest", { _id: id }); assert.ok(row); return row;
    };

    await suite.test("real guards keep secret/session fallback and withActivity actor mechanism", async () => {
      pages = []; const before = await business();
      for (const method of ["GET", "POST"] as const) {
        const start = sourceCalls;
        for (const actor of [null, { user: { email: "staff@day1company.co.kr", name: "Staff" }, expires: "" }, { user: { email: "outside@example.invalid", name: "Outside" }, expires: "" }]) {
          await fixedError(await invoke(method, "Bearer wrong", actor), "admin 권한이 필요합니다.");
        }
        assert.equal(sourceCalls, start);
        for (const [authorization, actor, actorType] of [[undefined, admin, "user"], [`Bearer ${secret}`, null, "token_request"], ["Bearer wrong", admin, "token_request"]] as const) {
          const response = await invoke(method, authorization, actor); assert.equal(response.status, 200);
          const audit = await requestRow(response); assert.equal(audit.actorType, actorType);
          assert.equal(audit.actorEmail, actorType === "user" ? admin.user.email : null);
        }
      }
      assert.deepEqual(await business(), before);
    });

    await suite.test("all three missing scoped services stop source and PG before side effects", async () => {
      pages = [page(101)]; const before = await business(), calls = sourceCalls;
      for (const method of ["GET", "POST"] as const) {
        const handler = method === "GET" ? GET : POST;
        for (const partial of [{ instructorNotionSync: repository, requestActivity }, { instructorNotionSource: source, requestActivity }]) {
          const response = await runWithDataRepositories(partial, () => actors.run(admin, () => handler(request(method))));
          assert.equal(response.status, 500); assert.equal((await response.json()).ok, false);
        }
        await assert.rejects(runWithDataRepositories({ instructorNotionSync: repository, instructorNotionSource: source }, () => actors.run(admin, () => handler(request(method)))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      }
      assert.equal(sourceCalls, calls); assert.equal(pgCalls, 0); assert.deepEqual(await business(), before);
    });

    await suite.test("preview keeps original NO/details, duplicate virtual creates and zero business/guard writes", async () => {
      await repository.saveNote("Synthetic legacy", { displayName: "Manual display", notes: "Manual memo", partnerId: "manual-partner", recruitAvoid: true });
      pages = [page(20.5, "Synthetic legacy"), page(21, "Synthetic new"), page(21, "Synthetic new"), {}];
      const before = await business(), count = await store.collection("ActivityRequest").countDocuments();
      const response = await invoke("GET"); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, dryRun: true, result: { totalRows: 4, created: 2, updated: 1, skipped: 1, errors: 0, errorDetail: [], changes: [
        { coachName: "Synthetic legacy", action: "update_notion", details: "NO 20.5 연결(예전 행)" },
        { coachName: "Synthetic new", action: "create_notion", details: "신규 강사" },
        { coachName: "Synthetic new", action: "create_notion", details: "신규 강사" }
      ] } });
      assert.deepEqual(await business(), before); assert.equal(await store.collection("ActivityRequest").countDocuments(), count + 1);
      assert.equal((await requestRow(response)).status, 200);
    });

    await suite.test("apply keeps manual fields, strips profile PII and continues after invalid NO with fixed row error", async () => {
      pages = [page(20.5, "Synthetic legacy"), page(21, "Synthetic new"), page(2147483648, "Synthetic error-name secret"), {}, page(22, "Synthetic later")];
      const response = await invoke("POST"); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, result: { totalRows: 5, created: 2, updated: 1, skipped: 1, errors: 1, errorDetail: ["INSTRUCTOR_NOTION_ROW_FAILED"] } });
      const note = await repository.getNoteByNotionNo(20);
      assert.equal(note.displayName, "Manual display"); assert.equal(note.notes, "Manual memo"); assert.equal(note.partnerId, "manual-partner"); assert.equal(note.recruitAvoid, true);
      assert.equal(note.notionId, "aabbccdd112233445566778899aabbcc");
      assert.equal(note.notion?.memo, "Contact [이메일 비공개] [연락처 비공개]");
      for (const key of ["email", "email2", "contact", "contact2", "birthDate"]) assert.ok(!Object.hasOwn(note.notion ?? {}, key));
      assert.equal((await repository.getNoteByNotionNo(22)).instructorName, "Synthetic later");
      const audit = await requestRow(response); assert.equal(audit.actorEmail, admin.user.email);
      const changes = await store.scan("ActivityChange", { requestId: response.headers.get("X-Request-Id")! }); assert.equal(changes.length, 3);
      for (const change of changes) assert.equal(change.actorEmail, admin.user.email);
      const raw = JSON.stringify([await business(), await store.collection("ActivityRequest").find({}).toArray()]);
      for (const secretValue of [admin.user.email, admin.user.name, "Synthetic legacy", "Manual memo", "synthetic-person@example.invalid", "010-1234-5678"]) assert.ok(!raw.includes(secretValue));
    });

    await suite.test("source failure is fixed and initialize is never reached", async () => {
      const before = await business(); const init = mock.method(repository, "initialize");
      sourceError = new Error(`Synthetic source body ${secret} synthetic-person@example.invalid`);
      try {
        for (const method of ["GET", "POST"] as const) await fixedError(await invoke(method), "INSTRUCTOR_NOTION_SOURCE_FAILED");
        assert.equal(init.mock.callCount(), 0); assert.deepEqual(await business(), before);
      } finally { sourceError = undefined; init.mock.restore(); }
    });

    await suite.test("initialize fails once outside row catch for empty, skipped and valid source inputs", async () => {
      const before = await business(); const init = mock.method(repository, "initialize", () => { throw new Error(`Synthetic init driver ${secret}`); });
      try {
        for (const method of ["GET", "POST"] as const) {
          for (const input of [[], [{}], [page(301)]]) {
            pages = input; const calls = sourceCalls, initializations = init.mock.callCount();
            await fixedError(await invoke(method), "INSTRUCTOR_NOTION_INITIALIZE_FAILED");
            assert.equal(sourceCalls, calls + 1); assert.equal(init.mock.callCount(), initializations + 1);
          }
        }
        assert.deepEqual(await business(), before);
      } finally { init.mock.restore(); }
    });

    await suite.test("mapper exception stays a whole-request failure while earlier committed rows remain", async () => {
      // Deliberate synthetic source fault, not a representation possible in ordinary Notion JSON.
      const bad: JsonObject = {}; Object.defineProperty(bad, "properties", { get() { throw new Error(`Synthetic mapper secret ${secret}`); } });
      pages = [page(401), bad, page(402)];
      const before = await business();
      await fixedError(await invoke("GET"), "INSTRUCTOR_NOTION_MAPPING_FAILED"); assert.deepEqual(await business(), before);
      const response = await invoke("POST"); await fixedError(response, "INSTRUCTOR_NOTION_MAPPING_FAILED");
      assert.equal((await repository.getNoteByNotionNo(401)).instructorName, "Synthetic instructor 401");
      assert.deepEqual(await repository.getNoteByNotionNo(402), {});
      assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: response.headers.get("X-Request-Id")! }), 1);
    });

    await suite.test("late row audit failure rolls back only that row and allows later commits", async () => {
      await repository.saveNoteByNotionNo(502, { instructorName: "Synthetic before rollback", notes: "Manual rollback note" });
      const previous = await store.collection("InstructorNote").findOne({ notionNo: 502 }); assert.ok(previous);
      const audit = store.collection("ActivityChange");
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityChange"), { targetId: { $ne: previous._id } }] } });
      pages = [page(501), page(502, "Synthetic failed replacement"), page(503)];
      try {
        const response = await invoke("POST"); assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, result: { totalRows: 3, created: 2, updated: 0, skipped: 0, errors: 1, errorDetail: ["INSTRUCTOR_NOTION_ROW_FAILED"] } });
        assert.deepEqual(await store.collection("InstructorNote").findOne({ notionNo: 502 }), previous);
        assert.equal((await repository.getNoteByNotionNo(501)).notionNo, 501); assert.equal((await repository.getNoteByNotionNo(503)).notionNo, 503);
        assert.equal(await audit.countDocuments({ requestId: response.headers.get("X-Request-Id")! }), 2);
      } finally { await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityChange") }); }
    });

    await suite.test("request audit failure preserves business success and logs only fixed text", async () => {
      const audit = store.collection("ActivityRequest"), logs: unknown[][] = [];
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      const logger = mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
      pages = [page(601)];
      try {
        const response = await invoke("POST"); assert.equal(response.status, 200);
        assert.equal((await response.json()).result.created, 1); assert.equal((await repository.getNoteByNotionNo(601)).notionNo, 601);
        assert.equal(await audit.countDocuments({ _id: response.headers.get("X-Request-Id")! }), 0);
        assert.equal(await store.collection("ActivityChange").countDocuments({ requestId: response.headers.get("X-Request-Id")! }), 1);
        assert.deepEqual(logs, [["[activity] API request log write failed"]]);
      } finally { logger.mock.restore(); await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
    });
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
    assert.equal(errorCapture.mock.callCount(), 0, "Failures must not log source/driver/mapper details");
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally { errorCapture.mock.restore(); external.mock.restore(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    }
  }
});
