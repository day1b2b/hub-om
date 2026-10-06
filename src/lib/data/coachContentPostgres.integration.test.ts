import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { MongoClient } from "mongodb";
import { activityContext } from "../activity/context";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument } from "./mongoRuntimeCodec";
import { COACH_CONTENT_MODELS, MongoCoachContentRepository, prepareMongoCoachContentStore } from "./mongoCoachContentRepository";
import { PrismaCoachContentRepository } from "./prismaCoachContentRepository";
import type { CoachContentRecord, CoachContentRepository } from "./coachContentRepository";

/** Opt-in destructive setup, ONLY the disposable loopback content_parity database.
 * Apply every migration rather than db push: actual PG audit triggers are part of the baseline.
 * Run in a fresh process with env -i, COACH_CONTENT_PG_TEST_DATABASE_URL and
 * MONGODB_COACH_CONTENT_PARITY_TEST_URI. No .env files or production clients are loaded.
 */
const pgUrl = process.env.COACH_CONTENT_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_COACH_CONTENT_PARITY_TEST_URI;
const epoch = new Date("2099-01-01T00:00:00.000Z");
const at = (n: number) => new Date(epoch.getTime() + n * 1000);
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const author = { name: "Synthetic author", email: "synthetic-content@example.invalid" };
const ids = { a: id(1), b: id(2), c: id(3), deleted: id(4), inactive: id(5), history: id(6), deletedNote: id(7) };
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const byCoach = <T extends { coachId: string }>(rows: T[]) => [...rows].sort((a, b) => a.coachId.localeCompare(b.coachId));

function fixture() {
  const rows = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => {
    const row = coachFixtureRow(model, values);
    rows.set(model, [...(rows.get(model) ?? []), row]);
    return row;
  };
  for (const [coachId, name, status, isActive, deletedAt] of [
    [ids.c, "다 합성", "ACTIVE", true, null], [ids.deleted, "라 합성", "ACTIVE", true, at(1)],
    [ids.a, "가 합성", "ACTIVE", true, null], [ids.inactive, "마 합성", "INACTIVE", true, null],
    [ids.b, "나 합성", "ACTIVE", false, null]
  ] as const) add("Coach", { id: coachId, sourceCoachId: `content-${coachId}`, name, normalizedName: name, status, isActive, deletedAt, accessToken: null });
  for (let i = 0; i < 305; i++) {
    const coachId = [ids.a, ids.b, ids.deleted, ids.inactive][i % 4];
    add("CoachContentEntry", { id: id(1000 + i), coachId, kind: "NOTE", content: `Synthetic note ${i}`, authorName: i % 2 ? null : author.name, createdAt: at(i), updatedAt: at(i), flaggedAt: i === 304 ? at(1) : null });
    add("CoachEngagement", { id: id(2000 + i), sourceEngagementId: `content-engagement-${i}`, coachId, courseName: `Synthetic course ${i}`, status: i % 2 ? "CANCELLED" : "COMPLETED", source: "MANUAL", rating: i % 3 === 0 ? 0 : null, feedback: i % 3 === 0 ? null : i % 3 === 1 ? "" : "Synthetic feedback", createdAt: at(i), startDate: epoch, endDate: epoch, reviewFlaggedAt: i === 304 ? at(1) : null });
  }
  add("CoachContentEntry", { id: ids.history, coachId: ids.a, kind: "EDIT_HISTORY", content: "Synthetic old history", createdAt: at(999), updatedAt: at(999) });
  add("CoachContentEntry", { id: ids.deletedNote, coachId: ids.a, kind: "NOTE", content: "Synthetic soft-deleted note", deletedAt: at(1), createdAt: at(998), updatedAt: at(998) });
  add("CoachEngagement", { id: id(3000), coachId: ids.a, courseName: "Synthetic no review", sourceEngagementId: "content-no-review", rating: null, feedback: null, createdAt: at(999), startDate: epoch, endDate: epoch });
  for (const [coachId, lastEditedAt] of [[ids.b, null], [ids.c, at(10)], [ids.deleted, at(11)], [ids.inactive, null]] as const)
    add("CoachScheduleAccessLog", { coachId, yearMonth: "2099-01", accessedAt: at(2), lastEditedAt });
  add("CoachScheduleAccessLog", { coachId: ids.a, yearMonth: "2098-12", accessedAt: at(2), lastEditedAt: at(3) });
  return rows;
}

test("real PG/Mongo coach content parity with one shared synthetic fixture and PG audit triggers", { skip: !pgUrl || !mongoUri, timeout: 240_000 }, async suite => {
  const p = new URL(pgUrl!), m = new URL(mongoUri!);
  assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.pathname, "/content_parity"); assert.equal(p.username, "synthetic");
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol)); assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.search, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port);
  assert.equal(m.username, ""); assert.equal(m.password, ""); assert.equal(m.pathname, "/");
  assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000, monitorCommands: true });
  const wire = { getMore: 0, pages: [] as Array<{ collection: string; count: number; batchSize: number; singleBatch: boolean; cursorClosed: boolean }> };
  const pendingFinds = new Map<number, { collection: string; batchSize: number; singleBatch: boolean }>();
  client.on("commandStarted", event => {
    if (event.commandName === "getMore") wire.getMore++;
    if (event.commandName === "find") pendingFinds.set(event.requestId, {
      collection: String(event.command.find), batchSize: Number(event.command.batchSize ?? 0), singleBatch: event.command.singleBatch === true
    });
  });
  client.on("commandSucceeded", event => {
    const info = pendingFinds.get(event.requestId);
    if (info) {
      pendingFinds.delete(event.requestId);
      const cursor = (event.reply as { cursor: { firstBatch: unknown[]; id: unknown } }).cursor;
      wire.pages.push({ ...info, count: cursor.firstBatch.length, cursorClosed: String(cursor.id) === "0" });
    }
  });
  client.on("commandFailed", event => {
    pendingFinds.delete(event.requestId);
    // Driver messages can contain private values; emit only bounded command/code metadata.
    const failure = event.failure as Error & { code?: unknown };
    const code = typeof failure.code === "number" && Number.isSafeInteger(failure.code) ? failure.code : "unknown";
    const command = ["find", "getMore", "killCursors", "abortTransaction", "commitTransaction"].includes(event.commandName) ? event.commandName : "other";
    console.log(`[content-parity] MONGO_COMMAND_FAILED command=${command} code=${code}`);
  });
  const sql = new pg.Client({ connectionString: pgUrl });
  const databaseName = `hub_om_shadow_content_parity_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName, namespace: "shadow_content_parity", allowShadowWrites: true as const };
  let mongoConnected = false, sqlConnected = false;
  type Delegate = { createMany(args: { data: MongoRow[] }): Promise<unknown>; findMany(args: unknown): Promise<MongoRow[]> };
  let db: (Record<string, Delegate> & { $disconnect(): Promise<void> }) | undefined;
  try {
    await client.connect(); mongoConnected = true;
    assert.equal((await client.db("admin").command({ hello: 1 })).isWritablePrimary, true);
    await sql.connect(); sqlConnected = true;
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of migrations) await sql.query(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'coach_content_entries'::regclass AND tgname = 'activity_change' AND NOT tgisinternal")).rows[0].n, 1);
    const { getPrismaClient } = await import("./prisma");
    db = getPrismaClient() as unknown as NonNullable<typeof db>;
    await prepareMongoCoachContentStore(options);
    const store = new MongoOperationStore(options, COACH_CONTENT_MODELS);
    const rows = fixture();
    for (const [model, data] of rows) {
      await db[model[0].toLowerCase() + model.slice(1)].createMany({ data });
      await store.collection(model).insertMany(data.map(row => encodeMongoRuntimeDocument(model, row)));
    }
    const pgRepo = new PrismaCoachContentRepository(), mongoRepo = await MongoCoachContentRepository.open(options);
    console.log(`[content-parity] migrations=${migrations.length}; fixtures=${JSON.stringify(Object.fromEntries([...rows].map(([model, data]) => [model, data.length])))}`);

    await suite.test("note read baseline: NOTE-only, soft deletion and deleted/inactive coaches", async () => {
      for (const coachId of [ids.a, ids.deleted, ids.inactive]) {
        const expected = rows.get("CoachContentEntry")!.filter(row => row.coachId === coachId && row.kind === "NOTE" && row.deletedAt === null)
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .map(({ id, content, authorName, flaggedAt, createdAt }) => ({ id, content, authorName, flaggedAt, createdAt }));
        assert.deepEqual(await pgRepo.listNotes(coachId.toUpperCase()), expected);
        assert.deepEqual(await mongoRepo.listNotes(coachId.toUpperCase()), expected);
      }
    });

    await suite.test("feed baseline: independent latest 300 per source, zero/empty reviews and deleted/inactive coaches", async () => {
      const a = await pgRepo.getContentFeed();
      assert.deepEqual(a.entries.map(row => row.id), Array.from({ length: 300 }, (_, i) => id(1304 - i)));
      assert.deepEqual(a.reviewedEngagements.map(row => row.id), Array.from({ length: 300 }, (_, i) => id(2304 - i)));
      assert.equal(a.entries.length + a.reviewedEngagements.length, 600);
      for (const coachId of [ids.deleted, ids.inactive, ids.b]) assert.ok(a.entries.some(row => row.coach.id === coachId));
      assert.ok(a.reviewedEngagements.some(row => row.rating === 0)); assert.ok(a.reviewedEngagements.some(row => row.feedback === ""));
      assert.equal(a.entries[0].createdAt.toISOString(), at(304).toISOString());
      const coach = (coachId: unknown) => { const row = rows.get("Coach")!.find(row => row.id === coachId)!; return { id: row.id, name: row.name }; };
      const latest = (model: string, predicate: (row: MongoRow) => boolean) => rows.get(model)!.filter(predicate)
        .sort((x, y) => (y.createdAt as Date).getTime() - (x.createdAt as Date).getTime()).slice(0, 300);
      assert.deepEqual(a.entries, latest("CoachContentEntry", row => row.kind === "NOTE" && row.deletedAt === null)
        .map(({ id, kind, content, authorName, sourceField, flaggedAt, createdAt, coachId }) => ({ id, kind, content, authorName, sourceField, flaggedAt, createdAt, coach: coach(coachId) })));
      assert.deepEqual(a.reviewedEngagements, latest("CoachEngagement", row => row.rating !== null || row.feedback !== null)
        .map(({ id, rating, feedback, courseName, createdAt, reviewFlaggedAt, coachId }) => ({ id, rating, feedback, courseName, createdAt, reviewFlaggedAt, coach: coach(coachId) })));
      const offset = wire.pages.length;
      assert.deepEqual(await mongoRepo.getContentFeed(), a);
      for (const model of ["CoachContentEntry", "CoachEngagement"]) {
        const pages = wire.pages.slice(offset).filter(page => page.collection === `${options.namespace}_${model}`);
        assert.deepEqual(pages.map(page => page.count), [100, 100, 100]);
        assert.ok(pages.every(page => page.singleBatch && page.cursorClosed));
      }
      assert.equal(wire.getMore, 0);
      console.log("[content-parity] feed pages notes=100,100,100 reviews=100,100,100 getMore=0");
    });

    await suite.test("schedule baseline: status ACTIVE and not deleted, isActive false retained, exact month and normalized name order", async () => {
      const a = await pgRepo.getScheduleRegistration("2099-01"), b = await mongoRepo.getScheduleRegistration("2099-01");
      assert.deepEqual(b.coaches, a.coaches); assert.deepEqual(byCoach(b.accessLogs), byCoach(a.accessLogs));
      assert.deepEqual(a.coaches.map(row => row.id), [ids.a, ids.b, ids.c]);
      assert.deepEqual(byCoach(a.accessLogs), byCoach(rows.get("CoachScheduleAccessLog")!.filter(row => row.yearMonth === "2099-01").map(row => ({ coachId: row.coachId as string, lastEditedAt: row.lastEditedAt }))));
      const s = await pgRepo.getScheduleStatus("2099-01"), t = await mongoRepo.getScheduleStatus("2099-01");
      assert.deepEqual(t.activeCoaches, s.activeCoaches); assert.deepEqual(byCoach(t.accessLogs), byCoach(s.accessLogs));
      assert.deepEqual(s.activeCoaches, a.coaches.map(({ id, name }) => ({ id, name })));
      const logs = new Map(s.accessLogs.map(row => [row.coachId, row]));
      assert.deepEqual(s.activeCoaches.map(row => !logs.has(row.id) ? "notAccessed" : logs.get(row.id)!.lastEditedAt ? "completed" : "accessedOnly"), ["notAccessed", "accessedOnly", "completed"]);
      for (const repo of [pgRepo, mongoRepo]) assert.deepEqual((await repo.getScheduleStatus("2100-01")).accessLogs, []);
    });

    const auditPairs: Array<{ label: string; pgRequest: string; mongoRequest: string; pgId: string; mongoId: string }> = [];
    const run = async <T>(requestId: string, work: () => Promise<T>) => activityContext.run({ requestId, route: "/api/coaches/[id]/notes", method: "PATCH", actorType: "user", actorEmail: author.email, actorName: author.name }, work);
    const pair = async (label: string, work: (repo: CoachContentRepository, noteId: string) => Promise<CoachContentRecord>, pgId = "", mongoId = pgId) => {
      const pgRequest = randomUUID(), mongoRequest = randomUUID();
      const a = await run(pgRequest, () => work(pgRepo, pgId)), b = await run(mongoRequest, () => work(mongoRepo, mongoId));
      const normalize = (row: CoachContentRecord) => { assert.match(row.id, /^[a-f0-9-]{36}$/); for (const key of ["createdAt", "updatedAt", "flaggedAt", "deletedAt"] as const) if (row[key] !== null) assert.ok(row[key] instanceof Date && Number.isFinite(row[key].getTime())); return { ...row, id: "generated", createdAt: "date", updatedAt: "date", flaggedAt: row.flaggedAt ? "date" : null, deletedAt: row.deletedAt ? "date" : null }; };
      assert.deepEqual(normalize(b), normalize(a));
      auditPairs.push({ label, pgRequest, mongoRequest, pgId: a.id, mongoId: b.id });
      return [a, b] as const;
    };
    const histories = async () => {
      const select = (row: MongoRow) => ({ content: row.content, coachId: row.coachId, authorEmail: row.authorEmail, authorName: row.authorName, sourceField: row.sourceField });
      const order = (a: ReturnType<typeof select>, b: ReturnType<typeof select>) => JSON.stringify(a).localeCompare(JSON.stringify(b));
      const a = (await db!.coachContentEntry.findMany({ where: { kind: "EDIT_HISTORY" } })).map(select).sort(order);
      const b = (await store.scan("CoachContentEntry", { kind: "EDIT_HISTORY" })).map(select).sort(order);
      assert.deepEqual(b, a); return a;
    };
    await suite.test("CRUD baseline: author/content/date DTOs, warning toggles, deletion, history and legacy broad id+coachId matching", async () => {
      const [a, b] = await pair("create", repo => repo.createNote(ids.a.toUpperCase(), "  " + "가".repeat(45) + "  ", author));
      assert.equal(a.content, "  " + "가".repeat(45) + "  "); assert.equal(a.kind, "NOTE"); assert.equal(a.authorEmail, author.email);
      assert.equal(a.deletedAt, null); assert.equal(a.flaggedAt, null); assert.equal(a.sourceField, null);
      assert.deepEqual(Object.keys(b).sort(), ["id", "coachId", "kind", "content", "authorEmail", "authorName", "sourceField", "flaggedAt", "createdAt", "updatedAt", "deletedAt"].sort());
      await pair("update", (repo, noteId) => repo.updateNote(ids.a, noteId.toUpperCase(), "Synthetic edited", author), a.id, b.id);
      await pair("same-content", (repo, noteId) => repo.updateNote(ids.a, noteId, "Synthetic edited", author), a.id, b.id);
      const on = await pair("flag-on", (repo, noteId) => repo.toggleNoteWarning(ids.a, noteId, author), a.id, b.id); assert.ok(on[0].flaggedAt);
      const off = await pair("flag-off", (repo, noteId) => repo.toggleNoteWarning(ids.a, noteId, author), a.id, b.id); assert.equal(off[0].flaggedAt, null);
      const removed = await pair("delete", (repo, noteId) => repo.deleteNote(ids.a, noteId, author), a.id, b.id); assert.ok(removed[0].deletedAt);
      assert.ok(!(await pgRepo.listNotes(ids.a)).some(row => row.id === a.id)); assert.ok(!(await mongoRepo.listNotes(ids.a)).some(row => row.id === b.id));
      await pair("update-deleted", (repo, noteId) => repo.updateNote(ids.a, noteId, "Synthetic still deleted", author), a.id, b.id);
      await pair("update-history", repo => repo.updateNote(ids.a, ids.history, "Synthetic changed history", author));
      await pair("deleted-coach", repo => repo.createNote(ids.deleted, "Synthetic deleted coach note", author));
      const history = await histories();
      for (const content of ["메모 작성: " + "가".repeat(40) + "…", "메모 수정: Synthetic edited", "메모 경고 설정: Synthetic edited", "메모 경고 해제: Synthetic edited", "메모 삭제: Synthetic edited", "메모 수정: Synthetic still deleted", "메모 수정: Synthetic changed history", "메모 작성: Synthetic deleted coach note"])
        assert.ok(history.some(row => row.content === content && row.sourceField === "coach_content_entries.note" && row.authorEmail === author.email));
      assert.equal(history.filter(row => row.content === "메모 수정: Synthetic edited").length, 2);
      const before = await histories();
      for (const repo of [pgRepo, mongoRepo]) {
        await assert.rejects(repo.createNote(id(9999), "missing coach", author));
        await assert.rejects(repo.updateNote(ids.a, id(9999), "missing note", author));
        await assert.rejects(repo.updateNote(ids.b, ids.history, "wrong coach", author));
        await assert.rejects(repo.deleteNote(ids.a, id(9999), author));
        await assert.rejects(repo.toggleNoteWarning(ids.a, id(9999), author));
      }
      assert.deepEqual(await histories(), before);
    });

    await suite.test("real PG trigger vs Mongo audit: attribution, action, changed fields, history suppression and no-op", async () => {
      assert.equal(auditPairs.length, 9, "CRUD evidence must be complete");
      const differences: string[] = [];
      for (const pair of auditPairs) {
        const a = await db!.activityChange.findMany({ where: { requestId: pair.pgRequest } });
        const b = await store.scan("ActivityChange", { requestId: pair.mongoRequest });
        const normalize = (row: MongoRow, targetId: string) => {
          assert.equal(row.targetId, targetId); assert.equal(row.actorEmail, author.email); assert.equal(row.actorName, author.name);
          assert.equal(row.actorType, "user"); assert.equal(row.route, "/api/coaches/[id]/notes"); assert.equal(row.method, "PATCH");
          const changes = json(row.changes);
          if (changes.flagged_at && !changes.flagged_at.redacted) for (const side of ["before", "after"]) if (changes.flagged_at[side]) changes.flagged_at[side] = "date";
          return { targetType: row.targetType, action: row.action, changes };
        };
        const expectedCount = ["same-content", "update-history"].includes(pair.label) ? 0 : 1;
        assert.equal(a.length, expectedCount, `PG trigger count: ${pair.label}`);
        assert.equal(b.length, expectedCount, `Mongo audit count: ${pair.label}`);
        const pgAudit = a.map(row => normalize(row, pair.pgId)), mongoAudit = b.map(row => normalize(row, pair.mongoId));
        if (JSON.stringify(pgAudit).includes("Synthetic")) assert.fail("PG audit leaked synthetic content");
        try { assert.deepEqual(mongoAudit, pgAudit); } catch { differences.push(`${pair.label}: PG=${JSON.stringify(pgAudit)} Mongo=${JSON.stringify(mongoAudit)}`); }
      }
      assert.deepEqual(differences, [], "Audit parity differences (synthetic values only)");
    });
    await suite.test("singleBatch keyset scan visits every page including short BSON pages without getMore", async () => {
      const offset = wire.pages.length;
      const fixtureIds = rows.get("CoachContentEntry")!.filter(row => row.kind === "NOTE" && row.deletedAt === null).map(row => row.id as string);
      const scanned = await store.scan("CoachContentEntry", { _id: { $in: fixtureIds }, kind: "NOTE", deletedAt: null });
      const pgNotes = await db!.coachContentEntry.findMany({ where: { id: { in: fixtureIds }, kind: "NOTE", deletedAt: null }, select: { id: true } });
      assert.deepEqual(scanned.map(row => row.id).sort(), pgNotes.map(row => row.id).sort());
      const pages = wire.pages.slice(offset).filter(page => page.collection === `${options.namespace}_CoachContentEntry`);
      assert.ok(pages.length >= 4);
      assert.equal(pages.at(-1)!.count, 0, "only empty, not a short nonempty page, ends the scan");
      assert.ok(pages.every(page => page.singleBatch && page.cursorClosed));
      console.log(`[content-parity] full scan page counts=${pages.map(page => page.count).join(",")} getMore=${wire.getMore}`);

      // Three encrypted ~7 MiB documents fit the 32 MiB scan budget but not one
      // 16 MiB response. Keep them outside the fixed baseline namespace/fixture.
      const largeOptions = { ...options, namespace: "shadow_content_large" };
      await prepareMongoCoachContentStore(largeOptions);
      const largeStore = new MongoOperationStore(largeOptions, COACH_CONTENT_MODELS);
      const coach = coachFixtureRow("Coach", { id: id(9000), sourceCoachId: "synthetic-large-pages", name: "합성 큰페이지", normalizedName: "합성큰페이지", status: "ACTIVE", isActive: true });
      const notes = Array.from({ length: 3 }, (_, i) => coachFixtureRow("CoachContentEntry", {
        id: id(9100 + i), coachId: coach.id, kind: "NOTE", content: "L".repeat(5 * 1024 * 1024) + i,
        authorEmail: author.email, authorName: author.name, createdAt: at(2000 + i), updatedAt: at(2000 + i)
      }));
      for (const [model, data] of [["Coach", [coach]], ["CoachContentEntry", notes]] as const) {
        await db![model[0].toLowerCase() + model.slice(1)].createMany({ data: [...data] });
        await largeStore.collection(model).insertMany(data.map(row => encodeMongoRuntimeDocument(model, row)));
      }
      const largeRepo = await MongoCoachContentRepository.open(largeOptions);
      const compact = (row: { content: string }) => ({ ...row, content: { length: row.content.length, sha256: createHash("sha256").update(row.content).digest("hex") } });
      const checkPages = (start: number, label: string) => {
        const pages = wire.pages.slice(start).filter(page => page.collection === `${largeOptions.namespace}_CoachContentEntry`);
        assert.ok(pages.length >= 3, `${label}: BSON must force multiple reads`);
        assert.ok(pages[0].count > 0 && pages[0].count < 3, `${label}: first page is BSON-short`);
        assert.ok(pages[0].batchSize >= 100, "BSON truncation happens well below the requested batch size");
        assert.equal(pages.reduce((sum, page) => sum + page.count, 0), 3);
        assert.equal(pages.at(-1)!.count, 0);
        assert.ok(pages.every(page => page.singleBatch && page.cursorClosed));
        assert.equal(wire.getMore, 0);
        console.log(`[content-parity] ${label} BSON-short page counts=${pages.map(page => page.count).join(",")} wireBatchSize=${pages[0].batchSize} getMore=0`);
      };
      const listStart = wire.pages.length;
      const largeList = await largeRepo.listNotes(coach.id as string);
      checkPages(listStart, "list");
      assert.equal(largeList.length, 3);
      assert.deepEqual(largeList.map(compact), (await pgRepo.listNotes(coach.id as string)).map(compact));
      const feedStart = wire.pages.length;
      const largeFeed = await largeRepo.getContentFeed();
      checkPages(feedStart, "feed");
      assert.equal(largeFeed.entries.length, 3); assert.deepEqual(largeFeed.reviewedEngagements, []);
      const pgLargeFeed = (await pgRepo.getContentFeed()).entries.filter(row => row.coach.id === coach.id);
      assert.deepEqual(largeFeed.entries.map(compact), pgLargeFeed.map(compact));
      const scanStart = wire.pages.length;
      assert.deepEqual((await largeStore.scan("CoachContentEntry")).map(row => row.id), notes.map(row => row.id));
      checkPages(scanStart, "outside-transaction scan");
    });

  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (sqlConnected) await sql.end(); }
      finally {
        try { if (mongoConnected) { assert.match(databaseName, /^hub_om_shadow_content_parity_[a-f0-9]{16}$/); await client.db(databaseName).dropDatabase(); } }
        finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
