/** Actual HTTP/page boundaries. Native execution is owned by main.
 * Requires an explicit local MONGODB_ANNOUNCEMENT_TEST_URI replica set.
 * Only session supply and UI are substituted; guards, factories, audit and storage are real.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { BSON, MongoClient, type CommandStartedEvent, type Db } from "mongodb";
import { MONGO_ANNOUNCEMENT_RUNTIME_MODELS, openMongoAnnouncementRuntime, prepareMongoAnnouncementRuntime } from "./mongoAnnouncementRuntime";
import { MongoAnnouncementRepository } from "./mongoAnnouncementRepository";
import { MongoOperationStore, operationMongoValidator } from "./mongoOperationStore";
import { MongoRequestAuditRepository } from "./mongoRequestAuditRepository";
import { runWithDataRepositories } from "./dataRepositoryContext";
import type { AnnouncementFileInput } from "./announcements/announcementRepository";

const LIMIT = 5 * 1024 * 1024;
type Session = { user: { email: string; name: string | null }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "announcement-admin@day1company.co.kr", name: "Synthetic private author" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL access"); } } });
const ui = new Map<string, string>([
  ["@/components/AppSidebar", "AppSidebar"],
  ...["AnnouncementList", "AnnouncementActions", "AnnouncementForm"].map(name => [`@/features/announcements/${name}`, name] as const)
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const name = ui.get(specifier);
    if (name) return { url: `data:text/javascript,export function ${name}(){return null;}`, shortCircuit: true };
    if (specifier === "next/link") return { url: "data:text/javascript,export default function Link(){return null;}", shortCircuit: true };
    return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText, shortCircuit: true };
    return next(url, context);
  }
});
const collectionRoute = await import("../../app/api/announcements/route");
const itemRoute = await import("../../app/api/announcements/[id]/route");
const attachmentRoute = await import("../../app/api/announcements/[id]/attachments/[attachmentId]/route");
const { default: listPage } = await import("../../app/announcements/page");
const { default: detailPage } = await import("../../app/announcements/[id]/page");
const { default: editPage } = await import("../../app/announcements/[id]/edit/page");
const { default: newPage } = await import("../../app/announcements/new/page");
hooks.deregister();

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
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const fileContext = (id: string, attachmentId: string) => ({ params: Promise.resolve({ id, attachmentId }) });
const req = (method = "GET", form?: FormData) => new Request("https://example.invalid/api/announcements", { method, ...(form ? { body: form } : {}) });
function form(files: File[] = [], remove: string[] = [], title = " Synthetic title ", content = "<p>Hello <strong>world</strong></p>") {
  const result = new FormData(); result.set("title", title); result.set("content", content);
  files.forEach(file => result.append("files", file)); remove.forEach(id => result.append("removeAttachmentIds", id)); return result;
}
const smallFile = (name = "synthetic.bin") => new File([new Uint8Array([0, 255, 128, 13, 10])], name, { type: "application/octet-stream" });
const inputFile = (fileName = "synthetic.bin", length = 5): AnnouncementFileInput => ({ fileName, mimeType: "application/octet-stream", size: length, data: new Uint8Array(length).fill(137) });
async function expectJson(response: Response, status: number, value: unknown) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), value);
}
const missing = { ok: false, error: "공지사항을 찾을 수 없습니다." };
const missingFile = { ok: false, error: "첨부파일을 찾을 수 없습니다." };
const uri = process.env.MONGODB_ANNOUNCEMENT_TEST_URI;

test("announcement actual handlers/pages preserve authorization, multipart, storage and audit boundaries", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "DATABASE_URL"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const databaseName = `hub_om_shadow_announcement_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writes: CommandStartedEvent[] = [];
  const mutatingCommands = new Set([
    "create", "createIndexes", "collMod", "insert", "update", "delete", "drop", "dropDatabase", "dropIndexes",
    "findAndModify", "bulkWrite", "renameCollection", "convertToCapped", "emptycapped", "mapReduce",
  ]);
  client.on("commandStarted", event => {
    const outputAggregate = event.commandName === "aggregate" && Array.isArray(event.command.pipeline)
      && event.command.pipeline.some((stage: unknown) => stage !== null && typeof stage === "object"
        && (Object.hasOwn(stage, "$out") || Object.hasOwn(stage, "$merge")));
    if (mutatingCommands.has(event.commandName) || outputAggregate) writes.push(event);
  });
  let closeCalls = 0;
  const realClose = client.close.bind(client);
  Object.defineProperty(client, "close", { configurable: true, value: async (...args: Parameters<MongoClient["close"]>) => {
    closeCalls++; return await realClose(...args);
  } });
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }),
    PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email });
  delete process.env.DATABASE_URL; delete process.env.DEV_AUTH_BYPASS;
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external access"); });
  let connected = false, ownsDatabase = false;
  try {
    await client.connect(); connected = true;
    const databases = await client.db("admin").admin().listDatabases({ nameOnly: true });
    assert.equal(databases.databases.some(database => database.name === databaseName), false);
    ownsDatabase = true;
    const options = { client, databaseName, namespace: "shadow_handlers", allowShadowWrites: true as const };
    const secondRuntime = await prepareMongoAnnouncementRuntime({ ...options, namespace: "shadow_handlers_second" });
    const runtime = await prepareMongoAnnouncementRuntime(options);
    const store = new MongoOperationStore(options, MONGO_ANNOUNCEMENT_RUNTIME_MODELS);
    const scope = runtime.repositories;
    const runtimeSnapshot = async (namespace: string) => {
      const names = new Set([...MONGO_ANNOUNCEMENT_RUNTIME_MODELS.map(model => `${namespace}_${model}`), `${namespace}_CoachSchedulingGuard`]);
      const infos = (await client.db(databaseName).listCollections({}, { nameOnly: false }).toArray())
        .filter(info => names.has(info.name)).sort((a, b) => a.name.localeCompare(b.name));
      return BSON.EJSON.stringify(await Promise.all(infos.map(async info => ({
        info,
        indexes: await client.db(databaseName).collection(info.name).listIndexes().toArray(),
        documents: await client.db(databaseName).collection(info.name).find({}).sort({ _id: 1 }).toArray(),
      }))), { relaxed: false });
    };
    const readySnapshot = await runtimeSnapshot(options.namespace);
    writes.length = 0;
    await prepareMongoAnnouncementRuntime(options);
    await openMongoAnnouncementRuntime(options);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(await runtimeSnapshot(options.namespace), readySnapshot);

    let nestedCallbacks = 0;
    assert.throws(() => runtime.run(() => secondRuntime.run(() => { nestedCallbacks++; })), /CALENDAR_SCOPE_MISMATCH/);
    assert.equal(nestedCallbacks, 0);

    const partialNamespace = "shadow_handlers_partial";
    const foreignName = `${partialNamespace}_DataImportRun`;
    await client.db(databaseName).createCollection(foreignName);
    await client.db(databaseName).collection(foreignName).insertOne({ synthetic: "foreign-runtime-canary" });
    const partialSnapshot = BSON.EJSON.stringify({
      info: await client.db(databaseName).listCollections({ name: foreignName }, { nameOnly: false }).toArray(),
      indexes: await client.db(databaseName).collection(foreignName).listIndexes().toArray(),
      documents: await client.db(databaseName).collection(foreignName).find({}).toArray(),
    }, { relaxed: false });
    writes.length = 0;
    await assert.rejects(prepareMongoAnnouncementRuntime({ ...options, namespace: partialNamespace }),
      /^Error: MONGO_ANNOUNCEMENT_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(BSON.EJSON.stringify({
      info: await client.db(databaseName).listCollections({ name: foreignName }, { nameOnly: false }).toArray(),
      indexes: await client.db(databaseName).collection(foreignName).listIndexes().toArray(),
      documents: await client.db(databaseName).collection(foreignName).find({}).toArray(),
    }, { relaxed: false }), partialSnapshot);
    await client.db("admin").command({ ping: 1 });
    assert.equal(closeCalls, 0);

    // Interrupt the real sequence after request-audit collections and guard are ready,
    // but before the first announcement collection can be created.
    const failedNamespace = "shadow_handlers_failed";
    const originalDb = client.db.bind(client);
    let interrupted = false;
    Object.defineProperty(client, "db", { configurable: true, value: (name?: string, settings?: Parameters<MongoClient["db"]>[1]) => {
      const db = originalDb(name, settings);
      const create = db.createCollection.bind(db);
      Object.defineProperty(db, "createCollection", { configurable: true, value: async (...args: Parameters<Db["createCollection"]>) => {
        if (args[0] === `${failedNamespace}_Announcement`) { interrupted = true; throw new Error("synthetic announcement prepare interruption"); }
        return await create(...args);
      } });
      return db;
    } });
    try {
      await assert.rejects(prepareMongoAnnouncementRuntime({ ...options, namespace: failedNamespace }),
        /^Error: MONGO_ANNOUNCEMENT_RUNTIME_FAILED$/);
    } finally { Object.defineProperty(client, "db", { configurable: true, value: originalDb }); }
    assert.equal(interrupted, true);
    const failedSnapshot = await runtimeSnapshot(failedNamespace);
    assert.ok(failedSnapshot.includes(`${failedNamespace}_CoachSchedulingGuard`));
    writes.length = 0;
    await assert.rejects(prepareMongoAnnouncementRuntime({ ...options, namespace: failedNamespace }),
      /^Error: MONGO_ANNOUNCEMENT_RUNTIME_FAILED$/);
    assert.deepEqual(writes.map(event => event.commandName), []);
    assert.equal(await runtimeSnapshot(failedNamespace), failedSnapshot);
    await client.db("admin").command({ ping: 1 });
    assert.equal(closeCalls, 0);

    const run = <T>(work: () => Promise<T>, actor: Session | null = admin) => runtime.run(() => actors.run(actor, work));
    const create = (files: AnnouncementFileInput[] = [], title = "Synthetic seeded announcement", authorName: string | null = admin.user.name) => scope.announcements.create({
      title, content: "<p>Seeded content</p>", authorEmail: admin.user.email, authorName, attachments: files
    });
    const detail = async (id: string) => { const row = await scope.announcements.getDetail(id); assert.ok(row); return row; };
    const rawBusiness = async () => Promise.all(["Announcement", "AnnouncementAttachment"].map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()]));

    await suite.test("real API assertions throw; all four actual pages redirect for non-admin sessions", async () => {
      const id = randomUUID(), attachmentId = randomUUID();
      for (const actor of [null, { user: { email: "member@day1company.co.kr", name: "Member" }, expires: "" }, { user: { email: "outsider@example.invalid", name: "Outsider" }, expires: "" }]) {
        const calls = [() => collectionRoute.GET(), () => collectionRoute.POST(req("POST", form())),
          () => itemRoute.GET(req(), context(id)), () => itemRoute.PUT(req("PUT", form()), context(id)),
          () => itemRoute.DELETE(req("DELETE"), context(id)), () => attachmentRoute.GET(req(), fileContext(id, attachmentId))];
        for (const call of calls) await assert.rejects(run(call, actor), /admin 권한이 필요합니다/);
        for (const call of [() => listPage(), () => detailPage(context(id)), () => editPage(context(id)), () => newPage()]) {
          await assert.rejects(runWithDataRepositories({}, () => actors.run(actor, call)), /NEXT_REDIRECT/);
        }
      }
      assert.equal(await store.collection("Announcement").countDocuments(), 0);
      assert.equal(await store.collection("AnnouncementAttachment").countDocuments(), 0);
      assert.equal(await store.collection("ActivityChange").countDocuments(), 0);
    });

    await suite.test("empty actual page and new form retain props without database fallback", async () => {
      const list = component(await run(() => listPage()), "AnnouncementList");
      assert.deepEqual(list.props.announcements, []); assert.equal(list.props.loadFailed, false);
      assert.deepEqual(component(await run(() => newPage()), "AnnouncementForm").props, { mode: "create" });
      await expectJson(await run(() => collectionRoute.GET()), 200, { ok: true, announcements: [] });
    });

    await suite.test("multipart parser preserves malformed, blank, file-count and oversize rejection without writes", async () => {
      const target = await create(); const before = await rawBusiness();
      for (const method of ["POST", "PUT"]) {
        const invoke = (request: Request) => run(() => method === "POST" ? collectionRoute.POST(request) : itemRoute.PUT(request, context(target.id)));
        await assert.rejects(invoke(new Request("https://example.invalid", { method, headers: { "content-type": "application/json" }, body: "{}" })));
        await assert.rejects(invoke(new Request("https://example.invalid", { method, headers: { "content-type": "multipart/form-data; boundary=broken" }, body: "broken" })));
        const cases: Array<[FormData, string]> = [
          [form([], [], " "), "제목이 필요합니다."],
          [form([], [], "title", "<p> &nbsp; </p><script>hidden()</script>"), "내용이 필요합니다."],
          [form(Array.from({ length: 6 }, () => smallFile())), "첨부파일은 최대 5개까지 가능합니다."],
          [form([new File([new Uint8Array(LIMIT + 1)], "too-large.bin")]), "too-large.bin 파일은 5MB 이하만 첨부할 수 있습니다."]
        ];
        for (const [data, error] of cases) await expectJson(await invoke(req(method, data)), 400, { ok: false, error });
        const titleFile = form(); titleFile.set("title", smallFile());
        await expectJson(await invoke(req(method, titleFile)), 400, { ok: false, error: "제목이 필요합니다." });
      }
      assert.deepEqual(await rawBusiness(), before);
      // PUT's missing-parent preflight precedes title validation after form parsing.
      await expectJson(await run(() => itemRoute.PUT(req("PUT", new FormData()), context(randomUUID()))), 404, missing);
    });

    await suite.test("actual POST trims/sanitizes, ignores non-files, defaults MIME and attributes encrypted audits", async () => {
      const data = form([new File([], "empty.bin"), smallFile("한글 공지 #%.bin")], [], "  Synthetic private title  ", "<p onclick=\"bad()\">Hello <strong>world</strong></p><script>bad()</script>");
      data.append("files", "not a file"); data.append("authorEmail", "forged@example.invalid");
      const response = await run(() => collectionRoute.POST(req("POST", data)));
      assert.equal(response.status, 201); const payload = await response.json();
      assert.equal(payload.ok, true); assert.equal(payload.announcement.title, "Synthetic private title");
      assert.equal(payload.announcement.content, "<p>Hello <strong>world</strong></p>");
      assert.equal(payload.announcement.authorEmail, admin.user.email); assert.equal(payload.announcement.authorName, admin.user.name);
      assert.deepEqual(Object.keys(payload.announcement).sort(), ["id", "title", "content", "authorName", "authorEmail", "createdAt", "updatedAt"].sort());
      assert.equal(new Date(payload.announcement.createdAt).toISOString(), payload.announcement.createdAt);
      const row = await detail(payload.announcement.id); assert.equal(row.attachments.length, 2);
      const empty = row.attachments.find(file => file.fileName === "empty.bin"); assert.ok(empty);
      assert.equal(empty.mimeType, "application/octet-stream"); assert.equal(empty.size, 0);
      const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
      const audits = await store.scan("ActivityChange", { requestId }); assert.equal(audits.length, 3);
      for (const audit of audits) { assert.equal(audit.actorEmail, admin.user.email); assert.equal(audit.actorName, admin.user.name); assert.equal(audit.action, "create"); }
      const requestRow = await store.one("ActivityRequest", { _id: requestId }); assert.equal(requestRow?.status, 201);
      const raw = JSON.stringify([await rawBusiness(), await store.collection("ActivityChange").find({ requestId }).toArray(), await store.collection("ActivityRequest").findOne({ _id: requestId })]);
      for (const secret of ["Synthetic private title", admin.user.email, admin.user.name!, "한글 공지 #%.bin", "Hello <strong>world"]) assert.ok(!raw.includes(secret));
      const listResponse = await run(() => collectionRoute.GET()); const list = (await listResponse.json()).announcements;
      assert.ok(list.some((item: { id: string }) => item.id === row.id));
      assert.ok(list.every((item: object) => !Object.hasOwn(item, "content") && !Object.hasOwn(item, "attachments")));
    });

    await suite.test("actual POST accepts five files and the exact 5MiB boundary", async () => {
      const files = [new File([new Uint8Array(LIMIT)], "boundary.bin"), ...Array.from({ length: 4 }, (_, i) => smallFile(`extra-${i}.bin`))];
      const response = await run(() => collectionRoute.POST(req("POST", form(files))));
      assert.equal(response.status, 201);
      const payload = await response.json(), row = await detail(payload.announcement.id);
      assert.equal(row.attachments.length, 5);
      const boundary = row.attachments.find(file => file.fileName === "boundary.bin"); assert.ok(boundary);
      const download = await run(() => attachmentRoute.GET(req(), fileContext(row.id, boundary.id)));
      assert.equal(download.status, 200); assert.equal((await download.arrayBuffer()).byteLength, LIMIT);
    });

    await suite.test("UUID aliases, exact UTF8 download headers/bytes and absent versus malformed identifiers", async () => {
      const bytes = new Uint8Array([0, 255, 128, 65, 13, 10]); const name = "가상 첨부 #%.bin";
      const seeded = await create([{ fileName: name, mimeType: "application/x-synthetic", size: bytes.length, data: bytes }]);
      const file = (await detail(seeded.id)).attachments[0];
      const aliases = (id: string) => [id.toUpperCase(), id.replaceAll("-", ""), `{${id}}`, id.replaceAll("-", "").match(/.{4}/g)!.join("-")];
      for (const [index, id] of aliases(seeded.id).entries()) {
        assert.equal((await run(() => itemRoute.GET(req(), context(id)))).status, 200);
        const response = await run(() => attachmentRoute.GET(req(), fileContext(id, aliases(file.id)[index])));
        assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "application/x-synthetic");
        assert.equal(response.headers.get("Content-Disposition"), `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
      }
      const absent = randomUUID();
      await expectJson(await run(() => itemRoute.GET(req(), context(absent))), 404, missing);
      await expectJson(await run(() => itemRoute.DELETE(req("DELETE"), context(absent))), 404, missing);
      await expectJson(await run(() => attachmentRoute.GET(req(), fileContext(absent, file.id))), 404, missingFile);
      await expectJson(await run(() => attachmentRoute.GET(req(), fileContext(seeded.id, absent))), 404, missingFile);
      for (const invalid of ["not-a-uuid", ` ${seeded.id} `]) {
        await assert.rejects(run(() => itemRoute.GET(req(), context(invalid))));
        await assert.rejects(run(() => itemRoute.PUT(req("PUT", form()), context(invalid))));
        await assert.rejects(run(() => itemRoute.DELETE(req("DELETE"), context(invalid))));
        await assert.rejects(run(() => attachmentRoute.GET(req(), fileContext(seeded.id, invalid))));
      }
    });

    await suite.test("PUT preserves duplicate/foreign/absent removal-ID length counting, even when actual count exceeds five", async () => {
      const foreign = await create([inputFile("foreign.bin")]);
      const foreignFile = (await detail(foreign.id)).attachments[0];
      const foreignRaw = await store.collection("AnnouncementAttachment").findOne({ _id: foreignFile.id });
      for (const kind of ["duplicate", "foreign", "absent"] as const) {
        const parent = await create(Array.from({ length: 5 }, (_, index) => inputFile(`kept-${index}.bin`)));
        const initial = await detail(parent.id), own = initial.attachments[0].id;
        const keptId = initial.attachments[1].id;
        const keptRaw = await store.collection("AnnouncementAttachment").findOne({ _id: keptId });
        const ids = kind === "duplicate" ? [own, own] : [kind === "foreign" ? foreignFile.id : randomUUID()];
        const additions = kind === "duplicate" ? [smallFile("add-a.bin"), smallFile("add-b.bin")] : [smallFile("add.bin")];
        const data = form(additions, ids, " changed ", "<p>Changed</p>"); data.append("removeAttachmentIds", smallFile());
        const response = await run(() => itemRoute.PUT(req("PUT", data), context(parent.id)));
        assert.equal(response.status, 200); const payload = await response.json();
        assert.equal(payload.announcement.title, "changed"); assert.equal(payload.announcement.authorEmail, parent.authorEmail);
        assert.equal(payload.announcement.createdAt, parent.createdAt.toISOString()); assert.ok(!Object.hasOwn(payload.announcement, "attachments"));
        const after = await detail(parent.id); assert.equal(after.attachments.length, 6);
        assert.equal(after.attachments.some(file => file.id === own), kind !== "duplicate");
        assert.deepEqual(await store.collection("AnnouncementAttachment").findOne({ _id: keptId }), keptRaw);
      }
      assert.deepEqual(await store.collection("AnnouncementAttachment").findOne({ _id: foreignFile.id }), foreignRaw);
      const parent = await create([inputFile()]); const own = (await detail(parent.id)).attachments[0].id;
      assert.equal((await run(() => itemRoute.PUT(req("PUT", form([], [own.toUpperCase()])), context(parent.id)))).status, 200);
      assert.equal((await detail(parent.id)).attachments.length, 0);
      const before = await rawBusiness();
      await assert.rejects(run(() => itemRoute.PUT(req("PUT", form([], ["invalid-uuid"])), context(parent.id))));
      assert.deepEqual(await rawBusiness(), before);
    });

    await suite.test("soft delete keeps attachments and author but excludes all reads and repeat mutations", async () => {
      const parent = await create([inputFile()]); const file = (await detail(parent.id)).attachments[0];
      const rawFile = await store.collection("AnnouncementAttachment").findOne({ _id: file.id });
      await expectJson(await run(() => itemRoute.DELETE(req("DELETE"), context(parent.id))), 200, { ok: true });
      const row = await store.one("Announcement", { _id: parent.id }); assert.ok(row?.deletedAt);
      assert.equal(row.deletedBy, admin.user.email); assert.equal(row.authorEmail, parent.authorEmail);
      assert.deepEqual(await store.collection("AnnouncementAttachment").findOne({ _id: file.id }), rawFile);
      await expectJson(await run(() => itemRoute.GET(req(), context(parent.id))), 404, missing);
      await expectJson(await run(() => itemRoute.PUT(req("PUT", form()), context(parent.id))), 404, missing);
      await expectJson(await run(() => itemRoute.DELETE(req("DELETE"), context(parent.id))), 404, missing);
      await expectJson(await run(() => attachmentRoute.GET(req(), fileContext(parent.id, file.id))), 404, missingFile);
      const list = await (await run(() => collectionRoute.GET())).json(); assert.ok(!list.announcements.some((item: { id: string }) => item.id === parent.id));
      await assert.rejects(run(() => detailPage(context(parent.id))), /NEXT_HTTP_ERROR_FALLBACK;404/);
      await assert.rejects(run(() => editPage(context(parent.id))), /NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    await suite.test("missing request/business scopes fail without PG fallback; list page retains loadFailed", async () => {
      const before = await rawBusiness();
      let registeredCallbacks = 0;
      assert.throws(() => runWithDataRepositories({ announcements: scope.announcements }, () => { registeredCallbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
      assert.throws(() => runWithDataRepositories({ requestActivity: scope.requestActivity }, () => { registeredCallbacks++; }), /CALENDAR_SCOPE_MISMATCH/);
      assert.equal(registeredCallbacks, 0);
      const looseAnnouncements = await MongoAnnouncementRepository.open(options);
      const looseAudit = await MongoRequestAuditRepository.open(options);
      await assert.rejects(runWithDataRepositories({ announcements: looseAnnouncements }, () => actors.run(admin, () => collectionRoute.POST(req("POST", form())))), /DATA_REPOSITORY_NOT_CONFIGURED: requestActivity/);
      await assert.rejects(runWithDataRepositories({ requestActivity: looseAudit }, () => actors.run(admin, () => collectionRoute.POST(req("POST", form())))), /DATA_REPOSITORY_NOT_CONFIGURED: announcements/);
      const list = await runWithDataRepositories({}, () => actors.run(admin, () => listPage()));
      assert.deepEqual(component(list, "AnnouncementList").props, { announcements: [], loadFailed: true });
      for (const page of [detailPage, editPage]) await assert.rejects(runWithDataRepositories({}, () => actors.run(admin, () => page(context(randomUUID())))), /DATA_REPOSITORY_NOT_CONFIGURED: announcements/);
      assert.deepEqual(await rawBusiness(), before); assert.equal(pgCalls, 0);
    });

    await suite.test("late request-audit failure preserves actual POST success and emits only fixed logging", async () => {
      const audit = store.collection("ActivityRequest"), logs: unknown[][] = [];
      await store.db.command({ collMod: audit.collectionName, validator: { $and: [operationMongoValidator("ActivityRequest"), { status: { $lt: 0 } }] } });
      const logger = mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
      try {
        const response = await run(() => collectionRoute.POST(req("POST", form())));
        assert.equal(response.status, 201); const payload = await response.json(); assert.ok(await scope.announcements.getDetail(payload.announcement.id));
        const requestId = response.headers.get("X-Request-Id"); assert.ok(requestId);
        assert.equal(await audit.countDocuments({ _id: requestId }), 0);
        assert.equal(await store.collection("ActivityChange").countDocuments({ requestId }), 1);
        assert.deepEqual(logs, [["[activity] API request log write failed"]]);
      } finally { logger.mock.restore(); await store.db.command({ collMod: audit.collectionName, validator: operationMongoValidator("ActivityRequest") }); }
    });

    await suite.test("actual pages preserve author fallback, UTC date, file sizes/links, sanitizer and edit props", async () => {
      const parent = await create([inputFile("bytes.bin", 5), inputFile("kb.bin", 1024), inputFile("mb.bin", 1024 * 1024)], "Synthetic page title", null);
      const original = await detail(parent.id);
      const date = new Date("2026-09-28T23:30:00.000Z");
      await scope.announcements.update({ id: parent.id, title: parent.title, content: '<p onclick="bad()">Seeded content</p><script>bad()</script>', attachments: [], removeAttachmentIds: [] });
      await store.collection("Announcement").updateOne({ _id: parent.id }, { $set: { createdAt: date } });
      const output = await run(() => detailPage(context(parent.id))); const visible = textOf(output);
      assert.ok(visible.includes(`${admin.user.email} · 등록일 2026-09-28`));
      for (const size of ["(5B)", "(1.0KB)", "(1.0MB)"]) assert.ok(visible.includes(size));
      const links = elements(output).filter(element => element.type === "a").map(element => element.props.href);
      assert.deepEqual(links.sort(), original.attachments.map(file => `/api/announcements/${parent.id}/attachments/${file.id}`).sort());
      assert.equal(component(output, "AnnouncementActions").props.id, parent.id);
      const html = elements(output).find(element => element.props.className === "announcement-body"); assert.ok(html);
      assert.deepEqual(html.props.dangerouslySetInnerHTML, { __html: "<p>Seeded content</p>" });
      const edited = component(await run(() => editPage(context(parent.id))), "AnnouncementForm");
      assert.deepEqual(edited.props, { announcementId: parent.id, initialAttachments: original.attachments.map(({ id, fileName, size }) => ({ id, fileName, size })), initialContent: '<p onclick="bad()">Seeded content</p><script>bad()</script>', initialTitle: parent.title, mode: "edit" });
      const list = component(await run(() => listPage()), "AnnouncementList"); assert.equal(list.props.loadFailed, false);
      const rows = list.props.announcements as Array<{ id: string; createdAt: string; authorName: string | null }>;
      assert.equal(rows.find(row => row.id === parent.id)?.createdAt, date.toISOString());
      const named = await create(); assert.ok(textOf(await run(() => detailPage(context(named.id)))).includes(admin.user.name!));
      assert.ok(!elements(await run(() => detailPage(context(named.id)))).some(element => element.props.className === "announcement-attachments"));
      for (const page of [detailPage, editPage]) await assert.rejects(run(() => page(context(randomUUID()))), /NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    await suite.test("native ciphertext corruption yields loadFailed/throw rather than partial data or PG fallback", async () => {
      const parent = await create(); const raw = await store.collection("Announcement").findOne({ _id: parent.id }); assert.ok(raw);
      await store.collection("Announcement").updateOne({ _id: parent.id }, { $set: { title: "Synthetic corrupted plaintext" } }, { bypassDocumentValidation: true });
      try {
        const list = component(await run(() => listPage()), "AnnouncementList");
        assert.deepEqual(list.props, { announcements: [], loadFailed: true });
        await assert.rejects(run(() => collectionRoute.GET()));
        await assert.rejects(run(() => detailPage(context(parent.id))));
        await assert.rejects(run(() => editPage(context(parent.id))));
      } finally { await store.collection("Announcement").replaceOne({ _id: parent.id }, raw); }
      assert.equal(pgCalls, 0);
    });
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0); assert.equal(closeCalls, 0);
  } finally {
    try { if (connected && ownsDatabase) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await realClose(); }
      finally { external.mock.restore(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    }
  }
});
