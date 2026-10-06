import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mock, test } from "node:test";
import { AbstractCursor, BSON, ClientSession, MongoClient, MongoServerError, type CommandStartedEvent, type CommandSucceededEvent, type Document } from "mongodb";
import { ACTIVITY_READ_MODELS, MongoActivityReadRepository, MongoActivityReadError, prepareMongoActivityReadStore } from "./mongoActivityReadRepository";
import { MongoOperationStore, completeMongoRow, operationMongoIndexes, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import type { ActivityReadRepository } from "./activityReads/activityReadRepository";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { activityQuery } from "../activity/query";
import { feedQuery } from "../activity/feed";
import { legacyWhere } from "../activity/legacy";
import { usageFilters } from "../activity/usage";

const uri = process.env.MONGODB_ACTIVITY_READ_TEST_URI;
const at = new Date("2099-01-01T01:00:00.000Z"), actor = "Synthetic@example.invalid";
const id = (n: number) => `eeeeeeee-1234-4abc-8abc-${n.toString(16).padStart(12, "0")}`;
const query = (values: Record<string, string> = {}) => activityQuery(new URLSearchParams(values));
const feed = (values: Record<string, string> = {}) => feedQuery(new URLSearchParams({ period: "1", summary: "true", tab: "requests", ...values }), at);
const usage = () => usageFilters("2099-01-01", at);
function safe(error: unknown) { assert.ok(error instanceof Error); assert.ok(error instanceof MongoActivityReadError); assert.doesNotMatch(error.message, /Synthetic|example.invalid|injected-secret/); assert.equal((error as Error & { cause?: unknown }).cause, undefined); return true; }
function timeout(error: unknown) { safe(error); assert.match((error as MongoActivityReadError).code, /TIMEOUT|DEADLINE/); return true; }
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>) { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Synthetic barrier timeout")), 5000); })]); } finally { clearTimeout(timer); } }
// Node24 Symbol mocks do not reliably restore; preserve the exact descriptor.
function iterator(replacement: AbstractCursor[typeof Symbol.asyncIterator]) { const descriptor = Object.getOwnPropertyDescriptor(AbstractCursor.prototype, Symbol.asyncIterator); assert.ok(descriptor); Object.defineProperty(AbstractCursor.prototype, Symbol.asyncIterator, { ...descriptor, value: replacement }); return () => { Object.defineProperty(AbstractCursor.prototype, Symbol.asyncIterator, descriptor); assert.deepEqual(Object.getOwnPropertyDescriptor(AbstractCursor.prototype, Symbol.asyncIterator), descriptor); }; }
function noCompanions(value: unknown): void { if (!value || typeof value !== "object" || value instanceof Date) return; for (const [key, item] of Object.entries(value)) { assert.doesNotMatch(key, /PiiIndex$|Encrypted$|^_id$/); noCompanions(item); } }

test("activity reads on an isolated Mongo replica set", { skip: !uri, timeout: 240_000 }, async suite => {
  const address = new URL(uri!); assert.equal(address.protocol, "mongodb:"); assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)); assert.ok(address.port); assert.equal(address.username, ""); assert.equal(address.password, ""); assert.equal(address.pathname, "/"); assert.deepEqual([...address.searchParams.keys()], ["replicaSet"]); assert.ok(address.searchParams.get("replicaSet"));
  const databaseName = `hub_om_shadow_activity_read_${randomBytes(8).toString("hex")}`, client = new MongoClient(uri!, { directConnection: true, monitorCommands: true, serverSelectionTimeoutMS: 5000 });
  const writer = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const keys = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"], saved = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  let connected = false;
  async function fixture() {
    const options = { client, databaseName, namespace: `shadow_activity_read_${randomBytes(8).toString("hex")}`, allowShadowWrites: true as const };
    await prepareMongoActivityReadStore(options); const repo: ActivityReadRepository = await MongoActivityReadRepository.open(options), store = new MongoOperationStore({ ...options, client: writer }, ACTIVITY_READ_MODELS);
    const add = async (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row; };
    const request = (n: number, values: MongoRow = {}) => add("ActivityRequest", { id: id(n), occurredAt: at, actorEmail: actor, actorName: "Synthetic actor", actorType: "user", route: "/api/synthetic", method: "GET", status: 200, durationMs: 7, ...values });
    const change = (n: number, values: MongoRow = {}) => add("ActivityChange", { id: id(n), occurredAt: at, requestId: id(n), actorEmail: actor, actorName: "Synthetic actor", actorType: "user", route: "/api/synthetic", method: "PUT", targetType: "unknown_table", targetId: "Synthetic exact target", action: "update", changes: { title: { after: "Synthetic historical" } }, ...values });
    const replace = async (model: string, rowId: string, values: MongoRow) => { const before = await store.one(model, { _id: rowId }); assert.ok(before); await store.collection(model).replaceOne({ _id: rowId }, encodeMongoRuntimeDocument(model, completeMongoRow(model, { ...before, ...values }))); };
    const snapshot = async (): Promise<Record<string, Document[]>> => Object.fromEntries(await Promise.all(ACTIVITY_READ_MODELS.map(async (model: string) => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()])));
    return { options, store, repo, add, request, change, replace, snapshot };
  }
  async function observe<T>(work: () => Promise<T>) {
    const names: string[] = [], requests = new Map<number, string>(), pages: Array<{ model: string; ids: string[]; bytes: number }> = [], transactions = new Set<string>();
    const started = (event: CommandStartedEvent) => { if (event.databaseName !== databaseName) return; names.push(event.commandName); if (event.command.startTransaction) transactions.add(String(event.command.txnNumber)); if (["find", "aggregate"].includes(event.commandName)) requests.set(event.requestId, String(event.command.find ?? event.command.aggregate)); };
    const done = (event: CommandSucceededEvent) => { const reply = event.reply as Document, model = requests.get(event.requestId); if (model && reply.cursor?.firstBatch) pages.push({ model, ids: reply.cursor.firstBatch.map((row: Document) => String(row._id)), bytes: BSON.calculateObjectSize(reply) }); requests.delete(event.requestId); };
    client.on("commandStarted", started); client.on("commandSucceeded", done); try { return { result: await work(), names, pages, transactions }; } finally { client.off("commandStarted", started); client.off("commandSucceeded", done); }
  }
  function barrier(namespace: string, model: string) { const held = signal(), release = signal(), close = AbstractCursor.prototype.close; let paused = false; const patch = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await close.apply(this, args); if (!paused && this.namespace.collection === `${namespace}_${model}`) { paused = true; held.resolve(); await release.promise; } }); return { held, release, patch }; }
  try {
    await client.connect(); connected = true; await writer.connect();
    for (const n of [0, 49, 50, 51, 101]) await suite.test(`${n} rows: complete authentication before 50/51 paging; UUID desc ties and removed cursor`, async () => {
      const f = await fixture(); for (let i = 1; i <= n; i++) await f.request(i);
      const before = await f.snapshot(), observed = await observe(() => f.repo.adminList(query({ tab: "requests" }))), page = observed.result;
      assert.deepEqual(page.entries.map(row => row.id), Array.from({ length: Math.min(n, 50) }, (_, i) => id(n - i))); if (n) assert.deepEqual(page.entries[0], { id: id(n), occurredAt: at, actorEmail: actor, actorName: "Synthetic actor", actorType: "user", route: "/api/synthetic", method: "GET", status: 200, durationMs: 7 }); assert.equal(page.nextCursor, n > 50 ? `${at.toISOString()}|${id(n - 49)}` : null); noCompanions(page);
      assert.ok(!observed.names.some(name => ["insert", "update", "delete", "create", "collMod", "createIndexes", "getMore"].includes(name))); assert.deepEqual(await f.snapshot(), before);
      if (page.nextCursor) { await f.store.collection("ActivityRequest").deleteOne({ _id: id(n - 49) }); const next = await f.repo.adminList(query({ tab: "requests", cursor: page.nextCursor.toUpperCase() })); assert.deepEqual(next.entries.map(row => row.id), Array.from({ length: Math.min(n - 50, 50) }, (_, i) => id(n - 50 - i))); }
    });
    await suite.test("private matches beyond 51 candidates; public conditions exclude damaged non-candidates; unsupported clauses reject", async () => {
      const f = await fixture(); for (let i = 1; i <= 101; i++) await f.request(i, { actorEmail: i === 1 ? "MixedCase%_@example.invalid" : "Other@example.invalid" });
      assert.deepEqual((await f.repo.adminList(query({ tab: "requests", email: "mixedcase%_" }))).entries.map(row => row.id), [id(1)]);
      await f.request(102, { actorType: "token_request" }); await f.store.collection("ActivityRequest").updateOne({ _id: id(102) }, { $set: { actorNamePiiIndex: "0".repeat(64) } });
      assert.equal((await f.repo.adminList(query({ tab: "requests", actorType: "user" }))).entries.length, 50);
      await assert.rejects(f.repo.adminList(query({ tab: "requests" })), safe);
      const unsupported = query({ tab: "requests" }); Object.assign(unsupported.requests, { syntheticUnknown: true }); await assert.rejects(f.repo.adminList(unsupported), safe);
    });
    await suite.test("feed summary and usage independently preserve monitoring/user HMAC/case/space/empty/null contracts", async () => {
      const f = await fixture(), emails = ["A@example.invalid", "a@example.invalid", " A@example.invalid ", "", null, "A@example.invalid"];
      for (let i = 0; i < emails.length; i++) await f.request(i + 1, { actorEmail: emails[i], status: i === 0 ? 500 : 200 });
      await f.request(7, { route: "/api/admin/activity", actorEmail: "Monitor@example.invalid" }); await f.request(8, { actorType: "token_request", actorEmail: "Robot@example.invalid" }); await f.request(9, { actorType: "token_request", route: "/api/activity-feed" });
      await f.change(1); await f.change(2, { route: "/api/admin/activity" }); await f.change(3, { actorType: "token_request" });
      const before = await f.snapshot(); assert.deepEqual(await f.repo.usage(usage()), { requests: 6, errors: 1, automatedRequests: 1, changes: 2, users: 4 });
      const result = await f.repo.feed(feed({ errors: "true", route: "/does-not-match", cursor: `${at.toISOString()}|${id(1)}` })); assert.deepEqual(result.entries, []); assert.deepEqual(result.summary, { requests: 9, errors: 1, changes: 3, users: 7 }); noCompanions(result);
      const without = await f.repo.feed(feed({ summary: "false" })); assert.equal(without.summary, undefined); assert.ok(!Object.hasOwn(JSON.parse(JSON.stringify(without)), "summary"));
      assert.equal((await f.repo.adminList(query({ tab: "requests", email: " " }))).entries.length, 7); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("KST half-open bounds, UUID filter aliases, invalid DB UUID and exact text targetId", async () => {
      const f = await fixture(); await f.request(1, { occurredAt: new Date("2098-12-31T14:59:59.999Z") }); await f.request(2, { occurredAt: new Date("2098-12-31T15:00:00.000Z") }); await f.request(3, { occurredAt: new Date("2099-01-01T14:59:59.999Z") }); await f.request(4, { occurredAt: new Date("2099-01-01T15:00:00.000Z") });
      assert.deepEqual((await f.repo.feed(feed())).entries.map(row => row.id), [id(3), id(2)]);
      assert.deepEqual((await f.repo.adminList(query({ tab: "requests", requestId: id(2).toUpperCase() }))).entries.map(row => row.id), [id(2)]);
      const malformed = query({ tab: "requests", cursor: `${at.toISOString()}|${"-".repeat(36)}` }); await assert.rejects(f.repo.adminList(malformed), safe);
      await f.change(1, { targetId: " Exact-TEXT " }); assert.equal((await f.repo.adminList(query({ targetId: " Exact-TEXT " }))).entries.length, 1); assert.equal((await f.repo.adminList(query({ targetId: "exact-text" }))).entries.length, 0);
    });
    await suite.test("public LIKE single-character wildcard spans Unicode code points and newline; private substring stays literal", async () => {
      const f = await fixture(), routes = ["/synthetic/😀/end", "/synthetic/a/end", "/synthetic/ab/end", "/synthetic/\n/end", "/synthetic/_/end"];
      for (let i = 0; i < routes.length; i++) await f.request(i + 1, { route: routes[i], actorEmail: routes[i] });
      assert.deepEqual((await f.repo.adminList(query({ tab: "requests", route: "/synthetic/_/end" }))).entries.map(row => row.id), [id(5), id(4), id(2), id(1)]);
      assert.deepEqual((await f.repo.adminList(query({ tab: "requests", route: "/synthetic/\\_/end" }))).entries.map(row => row.id), [id(5)]);
      assert.deepEqual((await f.repo.adminList(query({ tab: "requests", email: "/synthetic/_/end" }))).entries.map(row => row.id), [id(5)]);
    });
    await suite.test("feed fetchedAt is captured inside callback before transaction commit", async () => {
      const f = await fixture(); await f.request(1); const commit = ClientSession.prototype.commitTransaction, before = new Date("2099-01-01T01:00:00.000Z"), after = new Date("2099-01-01T02:00:00.000Z"); let commits = 0;
      mock.timers.enable({ apis: ["Date"], now: before });
      const patch = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) { commits++; mock.timers.setTime(after.getTime()); return commit.apply(this, args); });
      try { const result = await f.repo.feed(feed()); assert.equal(commits, 1); assert.equal(result.fetchedAt, before.toISOString()); assert.equal(new Date().toISOString(), after.toISOString()); } finally { patch.mock.restore(); mock.timers.reset(); }
    });
    await suite.test("legacy private prefix AND/OR/NOT, whitespace email and unsupported source combinations", async () => {
      const f = await fixture(); await f.add("Coach", { id: id(900), name: "Synthetic coach", normalizedName: "synthetic coach", deletedAt: at });
      const contents = ["메모 작성: 합성", "메모 삭제: 합성", "리뷰 삭제 합성", "일반 합성 변경", " 메모 작성: 공백"];
      for (let i = 0; i < contents.length; i++) await f.add("CoachContentEntry", { id: id(i + 1), coachId: id(900), kind: "EDIT_HISTORY", content: contents[i], authorEmail: i === 4 ? null : actor, authorName: null, createdAt: at, sourceField: "Synthetic source" });
      for (const [action, expected] of [["create", [1]], ["delete", [3, 2]], ["update", [5, 4]]] as const) { const result = await f.repo.legacyList(legacyWhere(new URLSearchParams({ action }))); assert.deepEqual(result.entries.map(row => row.id), expected.map(id)); for (const row of result.entries) { assert.equal(row.targetHref, null); assert.equal(row.targetLabel, "Synthetic coach"); assert.equal(row.legacy, true); } noCompanions(result); }
      assert.equal((await f.repo.legacyList(legacyWhere(new URLSearchParams({ email: " " })))).entries.length, 4); assert.deepEqual(await f.repo.legacyList(null), { entries: [], nextCursor: null });
    });
    await suite.test("labels preserve current/fallback/redacted/uppercase behavior; dangling required relation fails", async () => {
      const f = await fixture(); await f.add("Company", { id: id(900), name: "Synthetic current company", normalizedName: "synthetic current company" });
      await f.change(1, { targetType: "companies", targetId: id(900) }); await f.change(2, { targetType: "companies", targetId: id(901) }); await f.change(3, { targetType: "companies", targetId: id(900).toUpperCase() }); await f.change(4, { changes: { title: { redacted: true } } });
      const result = await f.repo.adminList(query()); const rows = result.entries as Array<{ id: string; targetLabel?: string; labelSource: string | null }>;
      assert.deepEqual(rows.map(row => [row.id, row.targetLabel, row.labelSource]), [[id(4), undefined, null], [id(3), "Synthetic historical", "기록 당시"], [id(2), "Synthetic historical", "기록 당시"], [id(1), "Synthetic current company", "현재 정보"]]);
      await f.add("Course", { id: id(800), companyId: id(999), processSeq: 1, courseId: "Synthetic course", name: "Synthetic dangling" }); await f.change(5, { targetType: "courses", targetId: id(800) }); await assert.rejects(f.repo.adminList(query()), safe);
    });
    await suite.test("only the selected 50 labels are read, while every candidate activity is authenticated", async () => {
      const f = await fixture(); await f.add("Course", { id: id(800), companyId: id(999), processSeq: 1, courseId: "Synthetic course", name: "Synthetic dangling" });
      for (let i = 1; i <= 51; i++) await f.change(i, i === 1 ? { targetType: "courses", targetId: id(800) } : {});
      assert.equal((await f.repo.adminList(query())).entries.length, 50);
      await f.store.collection("ActivityChange").updateOne({ _id: id(1) }, { $set: { actorNamePiiIndex: "0".repeat(64) } }); await assert.rejects(f.repo.adminList(query()), safe);
    });
    for (const method of ["feed", "admin", "usage"] as const) await suite.test(`${method} real writer barrier keeps list/summary/labels on one snapshot`, async () => {
      const f = await fixture(); await f.request(1); await f.change(1, { targetType: "companies", targetId: id(900) }); await f.add("Company", { id: id(900), name: "Synthetic before", normalizedName: "synthetic before" });
      const held = barrier(f.options.namespace, method === "admin" ? "ActivityChange" : "ActivityRequest");
      const pending = method === "admin" ? f.repo.adminList(query()) : method === "feed" ? f.repo.feed(feed()) : f.repo.usage(usage()); void pending.catch(() => {});
      try { await bounded(Promise.race([held.held.promise, pending.then(() => { throw new Error("Snapshot barrier not reached"); })])); await f.request(2); await f.change(2); await f.replace("Company", id(900), { name: "Synthetic after" }); held.release.resolve(); const result = await pending;
        if (method === "admin") { assert.ok("entries" in result); assert.equal(result.entries.length, 1); assert.equal((result.entries[0] as { targetLabel: string }).targetLabel, "Synthetic before"); }
        else if (method === "feed") { assert.ok("summary" in result); assert.equal(result.entries.length, 1); assert.deepEqual(result.summary, { requests: 1, errors: 0, changes: 1, users: 1 }); }
        else assert.deepEqual(result, { requests: 1, errors: 0, automatedRequests: 0, changes: 1, users: 1 });
      } finally { held.release.resolve(); await Promise.allSettled([pending]); held.patch.mock.restore(); }
      assert.equal((await f.repo.usage(usage())).requests, 2);
    });
    for (const damage of ["missing-key", "wrong-key", "hmac", "json"] as const) await suite.test(`${damage} fails safely with no partial summary or raw mutation`, async () => {
      const f = await fixture(); await f.request(1); await f.change(1); const prior = process.env.PII_ENCRYPTION_KEYS!;
      if (damage === "missing-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ other: randomBytes(32).toString("base64") }); else if (damage === "wrong-key") process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") }); else await f.store.collection("ActivityChange").updateOne({ _id: id(1) }, { $set: damage === "hmac" ? { actorEmailPiiIndex: "0".repeat(64) } : { changes: { $json: { __pii: "pii:v1:damaged" } } } }, { bypassDocumentValidation: true });
      const before = await f.snapshot(); try { await assert.rejects(f.repo.feed(feed()), safe); await assert.rejects(f.repo.adminList(query()), safe); await assert.rejects(f.repo.usage(usage()), safe); assert.deepEqual(await f.snapshot(), before); } finally { process.env.PII_ENCRYPTION_KEYS = prior; }
    });
    await suite.test("real BSON-short pages return every matching row without getMore and authenticate the whole row", async t => {
      const f = await fixture(); for (let i = 1; i <= 3; i++) await f.request(i, { actorName: "x".repeat(5 * 1024 * 1024) });
      const result = await observe(() => f.repo.adminList(query({ tab: "requests" }))); assert.deepEqual(result.result.entries.map(row => row.id), [id(3), id(2), id(1)]); assert.ok(!result.names.includes("getMore"));
      const pages = result.pages.filter(page => page.model === `${f.options.namespace}_ActivityRequest` && page.ids.length); assert.ok(pages.length >= 2); assert.ok(pages.some(page => page.ids.length < 3 && page.bytes > 6 * 1024 * 1024)); assert.equal(pages.flatMap(page => page.ids).length, 3); assert.deepEqual([...new Set(pages.flatMap(page => page.ids))].sort(), [id(1), id(2), id(3)]);
      t.diagnostic(JSON.stringify({ bsonReplyBytes: pages.map(page => page.bytes), note: "real BSON-short paging; not the actual 32MiB boundary" }));
    });
    for (const limit of ["bytes", "rows"] as const) await suite.test(`${limit} scan limit instrumentation rejects entire response and restores cursor`, async t => {
      const f = await fixture(); await f.request(1); const before = await f.snapshot(), original = AbstractCursor.prototype[Symbol.asyncIterator]; let deliveries = 0;
      const restore = iterator(async function* (this: AbstractCursor) { for await (const row of { [Symbol.asyncIterator]: () => original.call(this) }) { if (this.namespace.collection !== `${f.options.namespace}_ActivityRequest`) { yield row; continue; } if (limit === "bytes") { deliveries++; yield { ...row, syntheticBudget: Buffer.alloc(32 * 1024 * 1024 + 1) }; } else for (let i = 0; i < 20_001; i++) { deliveries++; yield row; } } });
      try { await assert.rejects(f.repo.feed(feed()), error => { safe(error); assert.match((error as MongoActivityReadError).code, /LIMIT/); return true; }); } finally { restore(); }
      assert.equal(deliveries, limit === "bytes" ? 1 : 20_001); assert.deepEqual(await f.snapshot(), before); t.diagnostic("Injected cursor accounting; actual 32MiB/20k stored boundary not executed");
    });
    for (const phase of ["page", "commit", "endSession"] as const) await suite.test(`virtual 8s budget rejects late ${phase}, including after transaction completion`, async () => {
      const f = await fixture(); await f.request(1); const before = await f.snapshot(), now = performance.now.bind(performance), close = AbstractCursor.prototype.close, commit = ClientSession.prototype.commitTransaction, end = ClientSession.prototype.endSession; let elapsed = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const cursor = mock.method(AbstractCursor.prototype, "close", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["close"]>) { await close.apply(this, args); if (phase === "page" && this.namespace.collection === `${f.options.namespace}_ActivityRequest`) elapsed = 8001; });
      const transaction = mock.method(ClientSession.prototype, "commitTransaction", async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) { const result = await commit.apply(this, args); if (phase === "commit") elapsed = 8001; return result; });
      const session = mock.method(ClientSession.prototype, "endSession", async function (this: ClientSession, ...args: Parameters<ClientSession["endSession"]>) { const result = await end.apply(this, args); if (phase === "endSession") elapsed = 8001; return result; });
      try { await assert.rejects(f.repo.feed(feed()), timeout); } finally { session.mock.restore(); transaction.mock.restore(); cursor.mock.restore(); clock.mock.restore(); }
      assert.equal(elapsed, 8001); assert.deepEqual(await f.snapshot(), before);
    });
    await suite.test("driver retries an injected transient read error, sharing virtual4s+4.5s rather than resetting 8s", async () => {
      const f = await fixture(); await f.request(1); const before = await f.snapshot(), next = AbstractCursor.prototype.next, now = performance.now.bind(performance); let attempts = 0, elapsed = 0;
      const clock = mock.method(performance, "now", () => now() + elapsed);
      const patch = mock.method(AbstractCursor.prototype, "next", async function (this: AbstractCursor, ...args: Parameters<AbstractCursor["next"]>) { const result = await next.apply(this, args); if (this.namespace.collection === `${f.options.namespace}_ActivityRequest` && result !== null) { attempts++; if (attempts === 1) { elapsed = 4000; const error = new MongoServerError({ message: "synthetic transient", code: 112 }); error.addErrorLabel("TransientTransactionError"); throw error; } elapsed = 8500; } return result; });
      try { const observed = await observe(() => assert.rejects(f.repo.feed(feed()), timeout)); assert.ok(observed.transactions.size >= 2); } finally { patch.mock.restore(); clock.mock.restore(); }
      assert.ok(attempts >= 2); assert.equal(elapsed, 8500); assert.deepEqual(await f.snapshot(), before);
    });
    for (const problem of ["validator", "index"] as const) await suite.test(`open rejects ${problem} without repair or DDL`, async () => {
      const f = await fixture(), collection = f.store.collection("ActivityRequest"); if (problem === "validator") await f.store.db.command({ collMod: collection.collectionName, validator: {}, validationLevel: "moderate" }); else { const name = operationMongoIndexes("ActivityRequest")[0]?.name; assert.ok(name); await collection.dropIndex(name); }
      const before = await f.snapshot(), result = await observe(() => assert.rejects(MongoActivityReadRepository.open(f.options), safe)); assert.ok(!result.names.some(name => ["create", "createIndexes", "collMod", "insert", "update", "delete"].includes(name))); assert.deepEqual(await f.snapshot(), before);
    });
  } finally { try { if (connected) { assert.match(databaseName, /^hub_om_shadow_activity_read_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } } finally { try { await writer.close(); await client.close(); } finally { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } } } }
});
