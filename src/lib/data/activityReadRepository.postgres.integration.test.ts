import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { activityQuery, feedQuery, usageFilters, legacyWhere, originalActivityReadOracle } from "./activityReadOriginalOracle.fixture";
import { PrismaActivityReadRepository } from "./activityReads/prismaActivityReadRepository";
import { MongoActivityReadRepository, prepareMongoActivityReadStore } from "./mongoActivityReadRepository";

const pgUrl = process.env.ACTIVITY_READ_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_ACTIVITY_READ_TEST_URI;
const id = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2099-06-15T03:00:00.000Z");
const start = new Date("2099-06-14T15:00:00.000Z");
const end = new Date("2099-06-15T15:00:00.000Z");
const pagesAt = new Date("2099-06-13T15:00:00.000Z");
const probeAt = new Date("2099-06-16T15:00:00.000Z");
const models = ["Company", "Course", "OperationSession", "Coach", "CoachContentEntry", "CoachEngagement", "ActivityRequest", "ActivityChange"] as const;
const tables = ["companies", "courses", "operation_sessions", "coaches", "coach_content_entries", "coach_engagements", "activity_requests", "activity_changes"] as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const params = (values: Record<string, string> = {}) => new URLSearchParams(values);
const cursor = (date: Date, n: number) => `${date.toISOString()}|${id(n)}`;
const scalar = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scalar(item)]));
  return value;
};
function noCompanions(value: unknown): void {
  if (!value || typeof value !== "object" || value instanceof Date) return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!key.endsWith("PiiIndex") && !key.endsWith("Encrypted"), "no storage companions in response");
    noCompanions(item);
  }
}
test("39c70e2 frozen activity query/formatter/legacy oracle checksum", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("./activityReadOriginalOracle.fixture.ts", import.meta.url))).digest("hex"), "cf8222d43e906f15360ac07dd0632b20836db2877a8a8c188bc280a3c0ddd4cc");
});
test("frozen parser boundaries remain distinct from DB UUID failures", () => {
  assert.deepEqual(activityQuery(params({ email: "  " })), activityQuery(params()));
  assert.deepEqual((legacyWhere(params({ email: "  " })) as { authorEmail: unknown }).authorEmail, { contains: "", mode: "insensitive" });
  for (const values of [{ requestId: "not-uuid" }, { from: "2099-02-31" }, { from: "2099-06-16", until: "2099-06-15" }, { actorType: "robot" }, { action: "remove" }] as Record<string, string>[]) assert.throws(() => activityQuery(params(values)));
  assert.doesNotThrow(() => activityQuery(params({ cursor: start.toISOString() + "|" + "-".repeat(36) })));
  assert.throws(() => feedQuery(params({ period: "2" }), now));
  assert.throws(() => feedQuery(params({ extra: "x".repeat(2049) }), now));
  assert.doesNotThrow(() => feedQuery(params({ x: "a".repeat(2046) }), now));
  assert.throws(() => feedQuery(params({ x: "a".repeat(2047) }), now));
  assert.deepEqual(feedQuery(params({ from: "invalid", until: "invalid", period: "1" }), now), feedQuery(params({ period: "1" }), now));
  assert.doesNotThrow(() => usageFilters("2099-05-17", now));
  assert.doesNotThrow(() => usageFilters("2099-06-15", now));
  assert.throws(() => usageFilters("2099-05-16", now));
  assert.throws(() => usageFilters("2099-06-16", now));
});

function fixtures() {
  const data = new Map<typeof models[number], MongoRow[]>();
  const add = (model: typeof models[number], values: MongoRow) => {
    const row = coachFixtureRow(model, values); data.set(model, [...(data.get(model) ?? []), row]); return row;
  };
  add("Company", { id: id(1), name: "Synthetic company", normalizedName: "synthetic company" });
  add("Company", { id: id(2), name: "", normalizedName: "synthetic empty" });
  add("Course", { id: id(3), companyId: id(1), processSeq: 1, courseId: "Synthetic course key", name: "Synthetic course" });
  add("OperationSession", { id: id(4), courseRecordId: id(3), operationId: "Synthetic /한글#operation", roundNo: "2", deletedAt: start });
  for (const n of [5, 6]) add("Coach", { id: id(n), name: `Synthetic coach ${n}`, normalizedName: `synthetic coach ${n}`, sourceCoachId: `synthetic-coach-${n}`, deletedAt: n === 6 ? start : null });
  const contents = ["메모 작성: Synthetic one", "메모 삭제: Synthetic two", "리뷰 삭제 Synthetic three", " Synthetic 메모 작성:", "메모 작성: Synthetic five", "Synthetic 변경"];
  const authors = [null, "", "Case@synthetic.invalid", "case@synthetic.invalid", " case@synthetic.invalid ", "special%_\\😀"];
  contents.forEach((content, i) => add("CoachContentEntry", { id: id(20 + i), coachId: i === 2 ? id(6) : id(5), kind: "EDIT_HISTORY", content, authorEmail: authors[i], authorName: i === 0 ? null : "Synthetic legacy author", sourceField: i === 0 ? null : "synthetic.source", createdAt: new Date(start.getTime() + i), updatedAt: start, deletedAt: i === 4 ? start : null }));
  add("CoachContentEntry", { id: id(26), coachId: id(5), kind: "NOTE", content: "Synthetic non-history", createdAt: start });
  add("CoachEngagement", { id: id(30), coachId: id(6), operationSessionId: id(4), sourceEngagementId: "synthetic-engagement", courseName: "Synthetic engagement", startDate: new Date("2099-06-15T00:00:00.000Z"), endDate: new Date("2099-06-16T00:00:00.000Z") });
  const request = (n: number, route: string, email: string | null, actorType = "user", status = 200, occurredAt = start) =>
    add("ActivityRequest", { id: id(n), occurredAt, actorEmail: email, actorName: email === null ? null : "Synthetic request actor", actorType, route, method: "GET", status, durationMs: 7 });
  const change = (n: number, targetType: string, targetId: string, changes: unknown = {}, action = "update", occurredAt = start, actorType = "user") =>
    add("ActivityChange", { id: id(n), requestId: id(100), occurredAt, actorEmail: "Case@synthetic.invalid", actorName: null, actorType, route: "/synthetic/change", method: "PUT", targetType, targetId, action, changes });
  ["Case@synthetic.invalid", "case@synthetic.invalid", " case@synthetic.invalid ", "", null, "case@synthetic.invalid"].forEach((email, i) => request(100 + i, "/synthetic/business", email, "user", [200, 400, 500, 200, 200, 200][i]));
  ["/api/admin/activity", "/api/admin/activity/usage", "/api/activity-feed"].forEach((route, i) => request(110 + i, route, "monitor@synthetic.invalid", "user", 500));
  request(120, "/synthetic/business", "token@synthetic.invalid", "token_request", 500);
  request(121, "/api/activity-feed", "token@synthetic.invalid", "token_request");
  request(122, "/synthetic/business", null, "anonymous"); request(123, "/synthetic/business", null, "development");
  request(124, "/synthetic/business", "outside@synthetic.invalid", "user", 500, new Date(start.getTime() - 1));
  request(125, "/synthetic/business", "outside@synthetic.invalid", "user", 500, end);
  const targets: Array<[string, string, unknown, string?]> = [
    ["operation_sessions", id(4), { name: { after: "Saved ignored" } }],
    ["coaches", id(5), {}], ["coaches", id(6), {}], ["courses", id(3), {}], ["companies", id(1), {}],
    ["coach_content_entries", id(20), {}], ["coach_engagements", id(30), {}],
    ["calendar_event_links", "plain calendar target", { operation_id: { after: "Synthetic /한글#operation" } }, "create"],
    ["coaches", id(999), { name: { after: "Synthetic saved missing" } }],
    ["coaches", id(5).toUpperCase(), { name: { after: "Synthetic uppercase fallback" } }],
    ["unsupported", "opaque/target", { name: { redacted: true }, title: { after: "Synthetic title fallback" } }],
    ["companies", id(2), { name: { after: "Synthetic saved empty" } }],
    ["unsupported", "Case Sensitive", { name: { after: null, before: "Synthetic before" } }],
    ["calendar_event_links", "plain restore", { operation_id: { after: "Synthetic /한글#operation" } }, "restore"]
  ];
  targets.forEach(([type, target, changes, action], i) => change(200 + i, type, target, changes, action));
  change(220, "unsupported", "token", {}, "update", start, "token_request");
  change(221, "unsupported", "before", {}, "update", new Date(start.getTime() - 1));
  change(222, "unsupported", "after", {}, "update", end);
  for (const count of [49, 50, 51]) for (let i = 0; i < count; i++) {
    request(count * 100 + i, `/page/${count}`, i === 0 ? "needle@synthetic.invalid" : "hay@synthetic.invalid", "user", 200, pagesAt);
    change(count * 100 + 10000 + i, `page_${count}`, "plain", {}, "update", pagesAt);
  }
  const probes = ["literal%end", "literal_end", "literal\\end", "literal/end", "literal\nend", "literal😀end", "literalXend", "LITERALXEND", "literal%_\\😀end", "literal.end", "literal[ab]end"];
  probes.forEach((probe, i) => request(800 + i, "/probe/" + probe, probe, "development", 200, probeAt));
  return data;
}

test("real PG original/newPG/Mongo activity read parity", { skip: !pgUrl || !mongoUri, timeout: 240_000 }, async suite => {
  assert.equal(pgUrl, "postgresql://synthetic@127.0.0.1:56679/activity_reads_parity");
  assert.equal(mongoUri, "mongodb://127.0.0.1:27779/?replicaSet=activityreads20260929");
  const envNames = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_activity_reads_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_activity_reads_parity", namespace, allowShadowWrites: true as const };
  let db: ReturnType<typeof getPrismaClient> | undefined, pgConnected = false, mongoConnected = false;
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0], { db: "activity_reads_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.setName, "activityreads20260929"); assert.equal(hello.isWritablePrimary, true);
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    db = getPrismaClient(); const prisma = db, data = fixtures();
    const delegates = prisma as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    const seedPg = async () => {
      await sql.query(`TRUNCATE ${tables.join(",")} CASCADE`);
      for (const model of models) await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: data.get(model)!.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === MongoDbNull ? Prisma.DbNull : value === MongoJsonNull ? Prisma.JsonNull : value]))) });
    };
    await prepareMongoActivityReadStore(options);
    const store = new MongoOperationStore(options, models), mongo = await MongoActivityReadRepository.open(options);
    for (const model of models) await store.collection(model).insertMany(data.get(model)!.map(row => encodeMongoRuntimeDocument(model, row)));
    const outputs: unknown[] = [];
    for (const backend of ["original PG", "new PG", "native Mongo"] as const) await suite.test(backend, async () => {
      const isMongo = backend === "native Mongo"; if (!isMongo) await seedPg();
      // Keep the frozen oracle inference independent of the new repository DTO type.
      const repo = isMongo ? mongo : backend === "new PG" ? new PrismaActivityReadRepository() : originalActivityReadOracle(prisma);
      const raw = async (model: typeof models[number]): Promise<MongoRow[]> => isMongo ? store.collection(model).find({}).sort({ _id: 1 }).toArray()
        : (await sql.query(`SELECT row_to_json(t) AS row FROM ${tables[models.indexOf(model)]} t ORDER BY id`)).rows.map(row => row.row);
      const snapshot = async () => {
        const result: string[] = [];
        for (const model of models) result.push(digest(await raw(model)));
        return result;
      };
      const before = await snapshot(), cases: unknown[] = [];
      // A missing raw companion is not equivalent to null. Assert own keys and
      // exact HMAC against independently calculated synthetic plaintext values.
      for (const model of ["ActivityRequest", "ActivityChange"] as const) {
        const expectedRows = new Map(data.get(model)!.map(row => [String(row.id), row]));
        for (const stored of await raw(model)) {
          const expected = expectedRows.get(String(stored.id ?? stored._id))!;
          for (const field of ["actorEmail", "actorName"] as const) {
            const column = isMongo ? field + "PiiIndex" : field === "actorEmail" ? "actor_email_pii_index" : "actor_name_pii_index";
            assert.ok(Object.hasOwn(stored, column), "stored companion key must exist");
            const expectedHmac = expected[field] === null ? null : createHmac("sha256", Buffer.from(process.env.PII_INDEX_KEY!, "base64"))
              .update(model + "." + field).update("\0").update(String(expected[field])).digest("hex");
            assert.equal(stored[column], expectedHmac);
          }
        }
      }
      const record = <T>(name: string, value: T): T => {
        noCompanions(value); cases.push({ name, value: scalar(value), json: JSON.parse(JSON.stringify(value)) }); return value;
      };
      const admin = async (name: string, values: Record<string, string>) => record(name, await repo.adminList(activityQuery(params(values))));
      const legacy = async (name: string, values: Record<string, string>) => record(name, await repo.legacyList(legacyWhere(params(values))));
      const feed = async (name: string, values: Record<string, string>) => {
        const began = Date.now(), result = await repo.feed(feedQuery(params(values), now)), finished = Date.now();
        const timestamp = Date.parse(result.fetchedAt);
        assert.ok(timestamp >= began && timestamp <= finished, "fetchedAt lies within request");
        assert.equal(new Date(timestamp).toISOString(), result.fetchedAt);
        return record(name, { ...result, fetchedAt: "<request-time>" });
      };
      const fails = async (name: string, work: () => Promise<unknown>) => {
        let failed = false; try { await work(); } catch { failed = true; }
        assert.equal(failed, true, name); cases.push({ name, repositoryError: true, routeStatus: 503 });
      };
      for (const count of [0, 49, 50, 51]) {
        const requests = await admin(`requests-${count}`, { tab: "requests", route: `/page/${count}` });
        const changes = await admin(`changes-${count}`, { targetType: `page_${count}` });
        assert.equal(requests.entries.length, Math.min(count, 50)); assert.equal(changes.entries.length, Math.min(count, 50));
        const expectedRequests = Array.from({ length: Math.min(count, 50) }, (_, i) => id(count * 100 + count - 1 - i));
        assert.deepEqual(requests.entries.map(row => row.id), expectedRequests);
        assert.deepEqual(changes.entries.map(row => row.id), expectedRequests.map(value => id(Number(value.slice(-12)) + 10000)));
        assert.equal(requests.nextCursor, count > 50 ? cursor(pagesAt, 5101) : null);
        assert.equal(changes.nextCursor, count > 50 ? cursor(pagesAt, 15101) : null);
        const requestFeed = await feed(`feed-requests-${count}`, { period: "7", tab: "requests", route: `/page/${count}` });
        const changeFeed = await feed(`feed-changes-${count}`, { period: "7", targetType: `page_${count}` });
        assert.deepEqual(requestFeed.entries.map(row => row.id), expectedRequests);
        assert.deepEqual(changeFeed.entries.map(row => row.id), changes.entries.map(row => row.id));
        assert.equal(requestFeed.nextCursor, requests.nextCursor); assert.equal(changeFeed.nextCursor, changes.nextCursor);
      }
      const tail = await admin("request-cursor-tail", { tab: "requests", route: "/page/51", cursor: cursor(pagesAt, 5101) });
      assert.deepEqual(tail.entries.map(row => row.id), [id(5100)]);
      const uppercaseCursor = await admin("uppercase-cursor", { tab: "requests", route: "/page/51", cursor: cursor(pagesAt, 5101).toUpperCase() });
      assert.deepEqual(uppercaseCursor, tail);
      // This ID was never stored: keyset paging must not require cursor existence.
      const missingCursor = await admin("absent-cursor-row", { tab: "requests", route: "/page/51", cursor: cursor(pagesAt, 5151) });
      assert.equal(missingCursor.entries[0].id, id(5150));
      const needle = await admin("private-match-after-first-51-candidates", { tab: "requests", email: "NEEDLE@", route: "/page/51" });
      assert.deepEqual(needle.entries.map(row => row.id), [id(5100)]);
      const daily = { from: "2099-06-15", until: "2099-06-15" };
      const ordinary = await admin("ordinary-empty-email", { ...daily, tab: "requests" });
      assert.equal(ordinary.entries.length, 9);
      assert.deepEqual(await admin("ordinary-whitespace-email", { ...daily, tab: "requests", email: "  " }), ordinary);
      assert.equal((await admin("admin-monitoring-excluded", { ...daily, tab: "requests", route: "/api/" })).entries.length, 0);
      const summary = await feed("feed-all-summary", { period: "1", tab: "requests", summary: "true" });
      assert.deepEqual(summary.summary, { requests: 13, changes: 15, errors: 6, users: 6 });
      assert.equal(summary.entries.length, 13);
      const filtered = await feed("summary-independent", { period: "1", summary: "true", tab: "requests", requestId: id(100), route: "never-matches", errors: "true", action: "delete", targetType: "missing", targetId: "missing", cursor: cursor(start, 100) });
      assert.equal(filtered.entries.length, 0); assert.deepEqual(filtered.summary, summary.summary);
      const noSummary = await feed("summary-omitted", { period: "1" });
      assert.equal(noSummary.summary, undefined); assert.ok(!Object.hasOwn(JSON.parse(JSON.stringify(noSummary)), "summary"));
      const userSummary = await feed("summary-user", { period: "1", actorType: "user", summary: "true" });
      assert.deepEqual(userSummary.summary, { requests: 9, changes: 14, errors: 5, users: 5 });
      const usage = record("usage-fixed", await repo.usage(usageFilters("2099-06-15", now)));
      assert.deepEqual(usage, { requests: 6, errors: 2, automatedRequests: 1, changes: 14, users: 4 });
      const caseSummary = await feed("summary-case-insensitive-email", { period: "1", email: "CASE@", summary: "true" });
      assert.deepEqual(caseSummary.summary, { requests: 4, changes: 15, errors: 2, users: 3 });
      const views = await admin("all-labels", { ...daily, actorType: "user" });
      assert.equal(views.entries.length, 14);
      const view = (n: number) => views.entries.find(row => row.id === id(n)) as { targetLabel?: string; labelSource: string | null; targetHref: string | null; description?: string };
      assert.deepEqual(view(200).targetLabel, "Synthetic company · Synthetic course · 2회차");
      assert.equal(view(200).targetHref, "/operations/Synthetic%20%2F%ED%95%9C%EA%B8%80%23operation");
      assert.equal(view(201).targetLabel, "Synthetic coach 5"); assert.equal(view(201).targetHref, `/coaches/${id(5)}`);
      assert.equal(view(202).targetLabel, "Synthetic coach 6"); assert.equal(view(202).targetHref, null);
      assert.equal(view(203).targetLabel, "Synthetic company · Synthetic course"); assert.equal(view(204).targetLabel, "Synthetic company");
      assert.equal(view(205).targetHref, `/coaches/${id(5)}`); assert.equal(view(206).targetHref, null);
      assert.equal(view(207).description, "교육 일정의 캘린더 연결을 등록했습니다");
      assert.equal(view(208).targetLabel, "Synthetic saved missing"); assert.equal(view(208).labelSource, "기록 당시");
      assert.equal(view(209).targetLabel, "Synthetic uppercase fallback"); assert.equal(view(209).targetHref, null);
      assert.equal(view(210).targetLabel, "Synthetic title fallback");
      assert.equal(view(211).targetLabel, ""); assert.equal(view(211).labelSource, "기록 당시");
      assert.equal(view(212).targetLabel, "Synthetic before"); assert.equal(view(213).description, undefined);
      assert.equal((await admin("target-text-exact", { targetId: "Case Sensitive" })).entries.length, 1);
      assert.equal((await admin("target-text-different-case", { targetId: "case sensitive" })).entries.length, 0);
      assert.equal((await admin("uppercase-request-id", { ...daily, tab: "requests", requestId: id(100).toUpperCase() })).entries[0].id, id(100));
      const allLegacy = await legacy("legacy-all", {});
      assert.deepEqual(allLegacy.entries.map(row => row.id), [25, 24, 23, 22, 21, 20].map(id));
      assert.deepEqual(allLegacy.entries.map(row => row.action), ["update", "create", "update", "delete", "delete", "create"]);
      assert.equal(allLegacy.entries.find(row => row.id === id(22))!.targetHref, null);
      assert.deepEqual((await legacy("legacy-whitespace-email", { email: "  " })).entries.map(row => row.id), [25, 24, 23, 22, 21].map(id));
      for (const [action, expected] of [["create", [24, 20]], ["delete", [22, 21]], ["update", [25, 23]], ["restore", []]] as const) assert.deepEqual((await legacy("legacy-action-" + action, { action })).entries.map(row => row.id), expected.map(id));
      for (const values of [{ requestId: id(100) }, { actorType: "anonymous" }, { targetType: "companies" }, { targetId: "notuuid" }] as Record<string, string>[]) assert.equal((await legacy("legacy-unsupported-" + JSON.stringify(values), values)).entries.length, 0);
      assert.deepEqual(await legacy("legacy-ignored-request-filters", { tab: "requests", route: "not-found", errors: "true" }), allLegacy);
      assert.equal((await legacy("legacy-uppercase-target", { targetId: id(5).toUpperCase() })).entries.length, 5);
      assert.deepEqual((await legacy("legacy-delete-cursor", { action: "delete", cursor: cursor(new Date(start.getTime() + 2), 22) })).entries.map(row => row.id), [id(21)]);
      // Public LIKE patterns and encrypted JS literal strings deliberately share probes.
      for (const pattern of ["%", "_", "\\", "\\%", "\\_", "\\\\", "/", "\n", "😀", ".", "[ab]", "literal_end", "literal%end", "LITERAL", "literal\\", "literal_"]) {
        const publicRows = await admin("public-LIKE-" + JSON.stringify(pattern), { tab: "requests", actorType: "development", from: "2099-06-17", until: "2099-06-17", route: pattern });
        const privateRows = await admin("private-literal-" + JSON.stringify(pattern), { tab: "requests", actorType: "development", from: "2099-06-17", until: "2099-06-17", email: pattern });
        if (pattern === "%") { assert.equal(publicRows.entries.length, 11); assert.deepEqual(privateRows.entries.map(row => row.id), [id(808), id(800)]); }
        if (pattern === "_") { assert.equal(publicRows.entries.length, 11); assert.deepEqual(privateRows.entries.map(row => row.id), [id(808), id(801)]); }
        if (pattern === "literal_end") assert.deepEqual(publicRows.entries.map(row => row.id), [809, 806, 805, 804, 803, 802, 801, 800].map(id));
      }
      const invalidCursor = params({ tab: "requests", cursor: start.toISOString() + "|" + "-".repeat(36) });
      const parsed = activityQuery(invalidCursor);
      await fails("permissive-cursor-repository-503", () => repo.adminList(parsed));
      await fails("permissive-legacy-uuid-503", () => repo.legacyList(legacyWhere(params({ targetId: "-".repeat(36) }))));
      await fails("feed-permissive-cursor-503", () => repo.feed(feedQuery(invalidCursor, now)));
      // Store equality is required for successful reads AND failure paths.
      assert.deepEqual(await snapshot(), before);
      for (const model of ["Coach", "CoachContentEntry", "ActivityRequest", "ActivityChange"] as const) {
        const serialized = JSON.stringify(await raw(model));
        for (const secret of ["Case@synthetic.invalid", "case@synthetic.invalid", "needle@synthetic.invalid", "Synthetic legacy author", "Synthetic request actor"]) assert.equal(serialized.includes(secret), false, model + " raw privacy");
      }
      console.log(`[activity-read-pg] backend=${backend} cases=${cases.length} rawUnchanged=true`);
      outputs.push(cases);
    });
    assert.equal(outputs.length, 3);
    assert.deepEqual(outputs[1], outputs[0], "new PG matches frozen original");
    assert.deepEqual(outputs[2], outputs[0], "Mongo matches frozen original");
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (pgConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) for (const collection of await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray()) {
            assert.match(namespace, /^shadow_activity_reads_pg_[a-f0-9]{16}$/);
            assert.ok(collection.name.startsWith(namespace + "_")); await client.db(options.databaseName).collection(collection.name).drop();
          }
        } finally {
          await client.close();
          for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        }
      }
    }
  }
});
