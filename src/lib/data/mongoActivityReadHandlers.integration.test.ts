/** Actual activity GET integration. Execution/DB ownership belongs to main.
 * Only auth session supply is mocked; public guards, parser, factory and Mongo repository are real.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { MongoClient, type ClientSession, type TransactionOptions } from "mongodb";
import { ACTIVITY_READ_MODELS, MongoActivityReadRepository, prepareMongoActivityReadStore } from "./mongoActivityReadRepository";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { runWithDataRepositories } from "./dataRepositoryContext";

type Session = { user: { email: string; name: string }; expires: string };
const actors = new AsyncLocalStorage<Session | null>();
const admin: Session = { user: { email: "activity-admin@day1company.co.kr", name: "Synthetic administrator" }, expires: "" };
mock.module("@/auth", { namedExports: { auth: async () => actors.getStore() ?? null } });
let pgCalls = 0;
mock.module("./prisma", { namedExports: { getPrismaClient: () => { pgCalls++; throw new Error("Unexpected PostgreSQL fallback"); } } });
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "next/server" || specifier === "next/navigation" ? `${specifier}.js` : specifier, context);
} });
const { GET: adminGET } = await import("../../app/api/admin/activity/route");
const { GET: feedGET } = await import("../../app/api/activity-feed/route");
const { GET: usageGET } = await import("../../app/api/admin/activity/usage/route");
hooks.deregister();

const NOW = Date.parse("2026-09-29T03:00:00.000Z"), DAY = "2026-09-29";
const START = Date.parse("2026-09-28T15:00:00.000Z"), END = START + 86_400_000;
const ADMIN_ERROR = "활동 기록을 불러오지 못했습니다. DB 연결과 마이그레이션 적용 상태를 확인하세요.";
const FEED_ERROR = "활동 기록 저장소를 확인할 수 없습니다.";
const USAGE_ERROR = "이용 현황을 불러오지 못했습니다.";
const urls = { admin: "/api/admin/activity", feed: "/api/activity-feed", usage: "/api/admin/activity/usage" };
function request(kind: keyof typeof urls, query: Record<string, string> = {}, authorization?: string) {
  return new Request(`https://example.invalid${urls[kind]}?${new URLSearchParams(query)}`, { headers: authorization === undefined ? {} : { authorization } });
}
async function errorResponse(response: Response, status: number, message: string) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: message });
}
function noCompanions(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(noCompanions); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!/(?:PiiIndex|Encrypted)$/.test(key), `Storage companion returned: ${key}`); noCompanions(item);
  }
}
const uri = process.env.MONGODB_ACTIVITY_READ_TEST_URI;

test("actual activity GETs use real authorization, native reads and unchanged HTTP contracts", { skip: !uri, timeout: 180_000 }, async suite => {
  const url = new URL(uri!);
  assert.equal(url.protocol, "mongodb:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.pathname, "/");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "ADMIN_EMAILS", "DEV_AUTH_BYPASS", "ACTIVITY_FEED_KEY", "DATABASE_URL"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  const token = randomBytes(32).toString("hex");
  Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture",
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false", ADMIN_EMAILS: admin.user.email, ACTIVITY_FEED_KEY: token });
  delete process.env.DEV_AUTH_BYPASS; delete process.env.DATABASE_URL;
  const databaseName = `hub_om_shadow_activity_handlers_${randomBytes(8).toString("hex")}`;
  const client = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
  const external = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external access"); });
  mock.timers.enable({ apis: ["Date"], now: NOW });
  let connected = false;
  try {
    await client.connect(); connected = true;
    const options = { client, databaseName, namespace: "shadow_handlers" };
    await prepareMongoActivityReadStore({ ...options, allowShadowWrites: true });
    const store = new MongoOperationStore(options, ACTIVITY_READ_MODELS);
    const repository = await MongoActivityReadRepository.open(options);
    // No requestActivity injection: these GETs must not introduce withActivity or retention writes.
    const scope = { activityReads: repository };
    const run = <T>(fn: () => Promise<T>, actor: Session | null = admin) => runWithDataRepositories(scope, () => actors.run(actor, fn));
    const adminRead = (query: Record<string, string> = {}) => run(() => adminGET(request("admin", query)));
    const feedRead = (query: Record<string, string> = {}) => run(() => feedGET(request("feed", query, `Bearer ${token}`)), null);
    const usageRead = (query: Record<string, string> = {}) => run(() => usageGET(request("usage", query)));
    const seed = async (model: string, values: MongoRow) => {
      const row = coachFixtureRow(model, { id: randomUUID(), ...values });
      await store.collection(model).insertOne(encodeMongoRuntimeDocument(model, row)); return row;
    };
    const raw = async () => Promise.all(ACTIVITY_READ_MODELS.map(async model => [model, await store.collection(model).find({}).sort({ _id: 1 }).toArray()]));
    const reqRow = (values: MongoRow = {}) => seed("ActivityRequest", { occurredAt: new Date(START), actorEmail: "Case@example.invalid", actorName: "Synthetic private actor", actorType: "user", route: "/api/work", method: "GET", status: 200, durationMs: 3, ...values });
    const changeRow = (values: MongoRow = {}) => seed("ActivityChange", { occurredAt: new Date(START), requestId: randomUUID(), actorEmail: "Case@example.invalid", actorName: "Synthetic private actor", actorType: "user", route: "/api/work", method: "PUT", targetType: "unknown", targetId: "exact TEXT", action: "update", changes: { name: { before: "Old private label", after: "Saved private label" } }, ...values });

    await suite.test("actual guards reject before malformed parsing or missing repository lookup", async () => {
      const before = await raw();
      for (const actor of [null, { user: { email: "staff@day1company.co.kr", name: "Staff" }, expires: "" }, { user: { email: "outside@example.invalid", name: "Outside" }, expires: "" }]) {
        for (const [handler, kind] of [[adminGET, "admin"], [usageGET, "usage"]] as const) {
          await errorResponse(await runWithDataRepositories({}, () => actors.run(actor, () => handler(request(kind, { date: "bad", from: "bad" })))), 403, "관리자 권한이 필요합니다");
        }
      }
      for (const key of [undefined, "x".repeat(31)]) {
        if (key === undefined) delete process.env.ACTIVITY_FEED_KEY; else process.env.ACTIVITY_FEED_KEY = key;
        const response = await feedGET(request("feed", { period: "bad" }, `Bearer ${token}`));
        assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
        await errorResponse(response, 503, "활동 조회 연결이 설정되지 않았습니다.");
      }
      process.env.ACTIVITY_FEED_KEY = token;
      for (const header of [undefined, token, `bearer ${token}`, "Bearer wrong", `Bearer ${"x".repeat(513)}`]) {
        await errorResponse(await runWithDataRepositories({}, () => feedGET(request("feed", { period: "bad" }, header))), 401, "조회 인증에 실패했습니다.");
      }
      assert.deepEqual(await raw(), before); assert.equal(pgCalls, 0);
    });

    await suite.test("actual parsers keep 400s, KST date range, feed period and 2048-character boundary", async () => {
      for (const query of [{ from: "bad" }, { from: "2026-02-30" }, { from: "2026-09-30", until: DAY }, { actorType: "robot" }, { action: "bad" }, { requestId: "bad" }, { cursor: "bad" }] as Array<Record<string, string>>) {
        assert.equal((await adminRead(query)).status, 400);
      }
      for (const date of ["bad", "2026-02-30", "2026-08-30", "2026-09-30"]) assert.equal((await usageRead({ date })).status, 400);
      for (const date of ["2026-08-31", DAY]) assert.equal((await usageRead({ date })).status, 200);
      await errorResponse(await feedRead({ period: "2" }), 400, "조회 기간을 확인하세요.");
      for (const period of ["1", "7", "30", "90", "365"]) assert.equal((await feedRead({ period, from: "bad", until: "bad" })).status, 200);
      // x= is two encoded characters; ignored values still count toward the URL query limit.
      assert.equal(new URLSearchParams({ x: "a".repeat(2046) }).toString().length, 2048);
      assert.equal((await feedRead({ x: "a".repeat(2046) })).status, 200);
      await errorResponse(await feedRead({ x: "a".repeat(2047) }), 400, "조회 조건이 너무 깁니다.");
      const malformedUUID = "-".repeat(36); // accepted by the original loose cursor parser, rejected by storage.
      await errorResponse(await adminRead({ cursor: `${new Date(START).toISOString()}|${malformedUUID}` }), 503, ADMIN_ERROR);
    });

    const first = await reqRow();
    await reqRow({ actorEmail: "case@example.invalid", status: 500 });
    await reqRow({ actorEmail: " Case@example.invalid " });
    await reqRow({ actorEmail: "" }); await reqRow({ actorEmail: null }); await reqRow();
    await reqRow({ route: "/api/admin/activity", status: 500 });
    await reqRow({ actorType: "token_request", actorEmail: null, status: 503 });
    await reqRow({ actorType: "anonymous", actorEmail: null, status: 404 });
    await reqRow({ actorType: "development", actorEmail: null });
    await reqRow({ occurredAt: new Date(START - 1) }); await reqRow({ occurredAt: new Date(END) });
    const company = await seed("Company", { name: "Current synthetic company", normalizedName: "currentsyntheticcompany" });
    const current = await changeRow({ targetType: "companies", targetId: company.id });
    const historical = await changeRow({ route: "/api/admin/activity" });
    await changeRow({ actorType: "token_request" });

    await suite.test("successful native HTTP DTOs preserve KST, monitoring, private searches and independent summary counts", async () => {
      const before = await raw();
      const response = await adminRead({ tab: "requests", from: DAY, until: DAY });
      assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const list = await response.json(); assert.equal(list.entries.length, 9); assert.equal(list.nextCursor, null); noCompanions(list);
      assert.ok(list.entries.some((row: { id: string; actorName: string }) => row.id === first.id && row.actorName === "Synthetic private actor"));
      assert.ok(list.entries.every((row: { occurredAt: string }) => row.occurredAt === new Date(START).toISOString()));
      const filtered = await (await adminRead({ tab: "requests", from: DAY, until: DAY, email: " CASE@ " })).json();
      assert.equal(filtered.entries.length, 4);
      const whitespace = await (await adminRead({ tab: "requests", from: DAY, until: DAY, email: "  " })).json(); assert.equal(whitespace.entries.length, 9);
      const changes = await (await adminRead({ from: DAY, until: DAY })).json(); noCompanions(changes);
      assert.equal(changes.entries.find((row: { id: string }) => row.id === current.id).targetLabel, "Current synthetic company");
      const savedLabel = changes.entries.find((row: { id: string }) => row.id === historical.id);
      assert.equal(savedLabel.targetLabel, "Saved private label"); assert.equal(savedLabel.labelSource, "기록 당시");
      const feed = await feedRead({ period: "1", tab: "requests", summary: "true", route: "no-match", errors: "true", targetId: "ignored-for-summary" });
      assert.equal(feed.status, 200); assert.equal(feed.headers.get("X-Content-Type-Options"), "nosniff");
      const summary = await feed.json(); assert.deepEqual(summary.entries, []);
      assert.deepEqual(summary.summary, { requests: 10, changes: 3, errors: 4, users: 4 }); noCompanions(summary);
      const noSummary = await (await feedRead({ period: "1", tab: "requests" })).json();
      assert.equal(noSummary.entries.length, 10); assert.ok(!Object.hasOwn(noSummary, "summary"));
      const usageResponse = await usageRead(); assert.equal(usageResponse.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(await usageResponse.json(), { date: DAY, requests: 6, errors: 1, automatedRequests: 1, changes: 2, users: 4, fetchedAt: new Date(NOW).toISOString() });
      const stored = JSON.stringify(await raw());
      for (const secret of ["Case@example.invalid", "Synthetic private actor", "Saved private label"]) assert.ok(!stored.includes(secret));
      // Company.name is operational in the existing policy; its current label remains public.
      assert.ok(stored.includes("Current synthetic company"));
      assert.deepEqual(await raw(), before); // includes both audit collections: GET introduces no request/change write.
    });

    await suite.test("legacy takes precedence over requests, retains prefix/NOT logic, nullable authors and deleted-coach links", async () => {
      const coach = await seed("Coach", { name: "Synthetic legacy coach", normalizedName: "syntheticlegacycoach", deletedAt: new Date(START) });
      for (const [content, authorEmail] of [["메모 작성: 가상", "legacy@example.invalid"], ["메모 삭제: 가상", "legacy@example.invalid"], ["리뷰 삭제 가상", "legacy@example.invalid"], ["일반 수정", "legacy@example.invalid"], ["작성자 없음", null]]) {
        await seed("CoachContentEntry", { coachId: coach.id, kind: "EDIT_HISTORY", content, authorEmail, authorName: null, createdAt: new Date(START), sourceField: "synthetic" });
      }
      const before = await raw();
      const base = { source: "legacy", tab: "requests", from: DAY, until: DAY };
      const all = await (await adminRead(base)).json(); assert.equal(all.entries.length, 5);
      for (const row of all.entries) { assert.equal(row.legacy, true); assert.equal(row.targetLabel, "Synthetic legacy coach"); assert.equal(row.targetHref, null); assert.equal(row.method, ""); }
      for (const [action, count] of [["create", 1], ["delete", 2], ["update", 2], ["restore", 0]] as const) {
        assert.equal((await (await adminRead({ ...base, action })).json()).entries.length, count);
      }
      assert.equal((await (await adminRead({ ...base, email: " " })).json()).entries.length, 4);
      for (const extra of [{ actorType: "anonymous" }, { targetType: "companies" }, { requestId: randomUUID() }] as Array<Record<string, string>>) {
        assert.deepEqual((await (await adminRead({ ...base, ...extra })).json()).entries, []);
      }
      assert.deepEqual(await raw(), before);
    });

    await suite.test("private literal match after 51 public candidates is found; cursor traverses tied timestamps", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 52; index++) {
        const id = `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`; ids.push(id);
        await reqRow({ id, route: "/api/paging", actorEmail: index === 0 ? "literal%_needle@example.invalid" : "other@example.invalid" });
      }
      const before = await raw();
      const query = { tab: "requests", route: "/api/paging", from: DAY, until: DAY };
      const firstPage = await (await adminRead(query)).json(); assert.equal(firstPage.entries.length, 50);
      assert.deepEqual(firstPage.entries.map((row: { id: string }) => row.id), [...ids].reverse().slice(0, 50));
      const secondPage = await (await adminRead({ ...query, cursor: firstPage.nextCursor })).json();
      assert.deepEqual(secondPage.entries.map((row: { id: string }) => row.id), [ids[1], ids[0]]); assert.equal(secondPage.nextCursor, null);
      const privateMatch = await (await adminRead({ ...query, email: "%_NEEDLE" })).json();
      assert.deepEqual(privateMatch.entries.map((row: { id: string }) => row.id), [ids[0]]);
      const uppercase = await (await adminRead({ tab: "requests", requestId: String(first.id).toUpperCase() })).json(); assert.equal(uppercase.entries[0].id, first.id);
      assert.deepEqual(await raw(), before);
    });

    await suite.test("missing explicit scope returns fixed 503 without requiring requestActivity or falling back to PG", async () => {
      const before = await raw();
      for (const [handler, kind, message] of [[adminGET, "admin", ADMIN_ERROR], [feedGET, "feed", FEED_ERROR], [usageGET, "usage", USAGE_ERROR]] as const) {
        await errorResponse(await runWithDataRepositories({}, () => actors.run(admin, () => handler(request(kind, {}, `Bearer ${token}`)))), 503, message);
      }
      assert.equal(pgCalls, 0); assert.deepEqual(await raw(), before);
    });

    await suite.test("actual closed Mongo client failure is sanitized by all three handlers without writes", async () => {
      const other = new MongoClient(uri!, { directConnection: true, serverSelectionTimeoutMS: 5000 });
      let broken: MongoActivityReadRepository;
      try { await other.connect(); broken = await MongoActivityReadRepository.open({ ...options, client: other }); }
      finally { await other.close(); }
      const before = await raw(), logs: unknown[][] = [];
      const logger = mock.method(console, "error", (...values: unknown[]) => { logs.push(values); });
      try {
        for (const [handler, kind, message] of [[adminGET, "admin", ADMIN_ERROR], [feedGET, "feed", FEED_ERROR], [usageGET, "usage", USAGE_ERROR]] as const) {
          await errorResponse(await runWithDataRepositories({ activityReads: broken }, () => actors.run(admin, () => handler(request(kind, {}, `Bearer ${token}`)))), 503, message);
        }
        assert.deepEqual(logs, []);
      } finally { logger.mock.restore(); }
      assert.deepEqual(await raw(), before); assert.equal(pgCalls, 0);
    });

    await suite.test("ciphertext corruption fails safely with no partial successful counts or rows", async () => {
      const original = await store.collection("ActivityRequest").findOne({ _id: first.id as string }); assert.ok(original);
      await store.collection("ActivityRequest").updateOne({ _id: first.id as string }, { $set: { actorEmail: "corrupted private plaintext" } }, { bypassDocumentValidation: true });
      const before = await raw();
      try {
        await errorResponse(await adminRead({ tab: "requests", from: DAY, until: DAY }), 503, ADMIN_ERROR);
        await errorResponse(await feedRead({ period: "1", summary: "true" }), 503, FEED_ERROR);
        await errorResponse(await usageRead(), 503, USAGE_ERROR);
        assert.deepEqual(await raw(), before);
      } finally { await store.collection("ActivityRequest").replaceOne({ _id: first.id as string }, original); }
    });

    await suite.test("controlled clock proves feed fetchedAt is inside transaction, usage is after transaction", async () => {
      const before = await raw(); const inner = NOW + 1000, after = NOW + 2000;
      const startSession = client.startSession.bind(client);
      const seam = mock.method(client, "startSession", (...args: Parameters<typeof client.startSession>) => {
        const session = startSession(...args); const transact = session.withTransaction.bind(session);
        mock.method(session, "withTransaction", async function<T>(callback: (active: ClientSession) => Promise<T>, transactionOptions?: TransactionOptions & { timeoutMS?: number }): Promise<T> {
          const result = await transact<T>(async active => { mock.timers.setTime(inner); return callback(active); }, transactionOptions);
          mock.timers.setTime(after); return result;
        });
        return session;
      });
      try {
        mock.timers.setTime(NOW);
        const feedResponse = await feedRead({ period: "1" }); assert.equal(feedResponse.status, 200);
        assert.equal((await feedResponse.json()).fetchedAt, new Date(inner).toISOString());
        mock.timers.setTime(NOW);
        const usageResponse = await usageRead(); assert.equal(usageResponse.status, 200);
        assert.equal((await usageResponse.json()).fetchedAt, new Date(after).toISOString());
        assert.equal(seam.mock.callCount(), 2);
      } finally { seam.mock.restore(); mock.timers.setTime(NOW); }
      assert.deepEqual(await raw(), before);
    });
    assert.equal(pgCalls, 0); assert.equal(external.mock.callCount(), 0);
  } finally {
    try { if (connected) await client.db(databaseName).dropDatabase(); }
    finally {
      try { await client.close(); }
      finally { mock.timers.reset(); external.mock.restore(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    }
  }
});
