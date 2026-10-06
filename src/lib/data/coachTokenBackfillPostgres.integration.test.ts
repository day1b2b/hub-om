import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { MongoClient } from "mongodb";
import pg from "pg";
import { activityContext } from "../activity/context";
import { backfillCoachAccessTokens } from "./coachAccessTokenBackfill";
import { coachTokenBackfillFixtures, expectedBackfilledTokens, expectedTokenBackfillDryRun, expectedTokenBackfillApply, expectedTokenBackfillRerun } from "./coachTokenBackfillFixtures";
import { getPrismaClient } from "./prisma";
import { coachFixtureRow } from "./mongoCoachFixtures";
import { MongoOperationStore, type MongoRow } from "./mongoOperationStore";
import { decodeMongoRuntimeDocument, encodeMongoRuntimeDocument, MongoJsonNull, mongoRuntimeBlindIndex } from "./mongoRuntimeCodec";
import { MongoCoachTokenBackfillRepository, prepareMongoCoachTokenBackfillStore } from "./mongoCoachTokenBackfillRepository";

const url = process.env.COACH_TOKEN_BACKFILL_PG_TEST_DATABASE_URL;
const uri = process.env.MONGODB_COACH_TOKEN_BACKFILL_TEST_URI;
const models = ["Coach", "CoachdbArchiveSnapshot", "CoachdbArchiveRow", "ActivityChange"] as const;
const tables = ["coaches", "coachdb_archive_snapshots", "coachdb_archive_rows", "activity_changes"] as const;
const id = (n: number) => `baccf111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => new Date(`2099-01-${String(n).padStart(2, "0")}T00:00:00.000Z`);
type Database = ReturnType<typeof getPrismaClient>;

/** Independent fixed oracle, deliberately not computed by either implementation.
 * Supplements the shared fixture with empty-current-token, JSON null and paging.
 * 251 additional coaches and >500 archive rows cross BOTH PG page boundaries.
 */
function fixture() {
  const initial = new Map<string, string | null>();
  const expected = new Map<string, string | null>();
  const coaches: MongoRow[] = [], snapshots: MongoRow[] = [], rows: MongoRow[] = [];
  const coach = (n: number, before: string | null, after: string | null, extra: MongoRow = {}) => {
    initial.set(id(n), before); expected.set(id(n), after);
    coaches.push(coachFixtureRow("Coach", { id: id(n), sourceCoachId: `parity-source-${n}`, accessToken: before, updatedAt: day(1), ...extra }));
  };
  for (const [n, startedAt, status] of [[1000, day(2), "completed"], [1001, day(3), "completed"], [1002, day(3), "completed"], [1003, day(4), "running"], [1004, day(5), "failed"]] as const) {
    snapshots.push(coachFixtureRow("CoachdbArchiveSnapshot", { id: id(n), startedAt, status, sourceDatabase: "parity-unrelated-database", sourceSchema: "parity-unrelated-schema" }));
  }
  let nextRow = 2000;
  const archive = (coachNumber: number, snapshot: number, data: unknown, extra: MongoRow = {}) => rows.push(coachFixtureRow("CoachdbArchiveRow", {
    id: id(nextRow++), snapshotId: id(snapshot), tableSchema: "public", tableName: "coaches", rowKey: `parity-source-${coachNumber}`, rowData: data, ...extra
  }));
  coach(1, null, "parity-latest-nonnull");
  archive(1, 1000, { access_token: "parity-latest-nonnull" }); archive(1, 1001, { access_token: null });
  coach(2, "", "parity-replaced-empty"); archive(2, 1000, { access_token: "parity-replaced-empty" });
  coach(3, "parity-old-three", " "); archive(3, 1000, { access_token: " " });
  coach(4, "parity-unchanged", "parity-unchanged"); archive(4, 1000, { access_token: "parity-unchanged" });
  coach(5, null, null);
  coach(6, "parity-old-six", "parity-tie-high-row-id");
  // Insert the larger row ID first and use the LOWER snapshot ID: neither insertion
  // order nor snapshot ID may substitute for the explicit archive row ID tie-break.
  archive(6, 1001, { access_token: "parity-tie-high-row-id" }, { id: id(9000) });
  archive(6, 1002, { access_token: "parity-tie-low-row-id" });
  coach(7, null, "parity-deleted-token", { deletedAt: day(1) }); archive(7, 1000, { access_token: "parity-deleted-token" });
  coach(8, "parity-inactive-old", "parity-inactive-token", { isActive: false, status: "INACTIVE" }); archive(8, 1000, { access_token: "parity-inactive-token" });
  coach(9, "parity-exact-preserved", "parity-exact-preserved");
  archive(9, 1000, { access_token: "parity-wrong-case" }, { rowKey: "PARITY-SOURCE-9" });
  archive(9, 1000, { access_token: "parity-wrong-space" }, { rowKey: " parity-source-9 " });
  archive(9, 1000, { access_token: "parity-wrong-schema" }, { tableSchema: "other" });
  archive(9, 1000, { access_token: "parity-wrong-table" }, { tableName: "other" });
  archive(9, 1003, { access_token: "parity-running" }); archive(9, 1004, { access_token: "parity-failed" });
  coach(10, "parity-invalid-shape-preserved", "parity-invalid-shape-preserved");
  archive(10, 1000, MongoJsonNull); archive(10, 1001, 42); archive(10, 1002, [{ access_token: "parity-array-ignored" }]);
  for (let n = 20; n <= 270; n++) {
    coach(n, null, `parity-page-token-${n}`);
    archive(n, 1000, { access_token: `parity-page-token-${n}` });
    archive(n, 1001, { access_token: null });
  }
  return { coaches, snapshots, rows, initial, expected };
}

// Run only with explicit disposable endpoints. No dotenv, global runtime shutdown,
// production env lookup, or cleanup of another worker's Mongo namespace.
test("token backfill: original PG with all migrations/privacy/audit matches native Mongo and independent expectations", { skip: !url || !uri, timeout: 240_000 }, async suite => {
  const p = new URL(url!), m = new URL(uri!);
  assert.ok(["postgres:", "postgresql:"].includes(p.protocol));
  assert.equal(p.hostname, "127.0.0.1"); assert.equal(p.pathname, "/coach_token_backfill_parity");
  assert.equal(p.username, "synthetic"); assert.equal(p.password, ""); assert.ok(p.port); assert.equal(p.search, ""); assert.equal(p.hash, "");
  assert.equal(m.protocol, "mongodb:"); assert.equal(m.hostname, "127.0.0.1"); assert.ok(m.port);
  assert.equal(m.username, ""); assert.equal(m.password, ""); assert.equal(m.pathname, "/"); assert.equal(m.hash, "");
  assert.deepEqual([...m.searchParams.keys()], ["replicaSet"]); assert.ok(m.searchParams.get("replicaSet"));
  const names = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { DATABASE_URL: url, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url });
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
  const namespace = `shadow_token_pg_${randomBytes(8).toString("hex")}`;
  const options = { client, databaseName: "hub_om_shadow_token_backfill_parity", namespace, allowShadowWrites: true as const };
  const actor = { requestId: id(99000), route: "/synthetic/token-backfill", method: "POST", actorEmail: "synthetic@example.invalid", actorName: "Synthetic actor", actorType: "user" as const };
  let db: Database | undefined, sqlConnected = false, mongoConnected = false;
  try {
    await sql.connect(); sqlConnected = true;
    const identity = (await sql.query("SELECT current_database() AS db, current_user AS usr")).rows[0];
    assert.deepEqual(identity, { db: "coach_token_backfill_parity", usr: "synthetic" });
    await client.connect(); mongoConnected = true;
    const hello = await client.db("admin").command({ hello: 1 });
    assert.equal(hello.isWritablePrimary, true); assert.equal(hello.setName, m.searchParams.get("replicaSet"));
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45, "baseline 1a7323b migration set");
    for (const migration of migrations) await sql.query(readFileSync(path.join(root, migration, "migration.sql"), "utf8"));
    assert.equal((await sql.query("SELECT to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed")).rows[0].installed, true);
    db = getPrismaClient(); const pgDb = db;
    await prepareMongoCoachTokenBackfillStore(options);
    const store = new MongoOperationStore(options, models);
    const mongo = await MongoCoachTokenBackfillRepository.open(options);
    const delegates = pgDb as unknown as Record<string, { createMany(args: { data: MongoRow[] }): Promise<unknown> }>;
    const seed = async (model: string, rows: MongoRow[]) => {
      const pgRows = rows.map(row => model === "CoachdbArchiveRow" && row.rowData === MongoJsonNull ? { ...row, rowData: Prisma.JsonNull } : row);
      await delegates[model[0].toLowerCase() + model.slice(1)].createMany({ data: pgRows });
      await store.collection(model).insertMany(rows.map(row => encodeMongoRuntimeDocument(model, row)));
    };
    const data = fixture();
    const shared = coachTokenBackfillFixtures();
    for (const row of shared.get("Coach")!) {
      data.initial.set(row.id as string, row.accessToken as string | null);
      data.expected.set(row.id as string, expectedBackfilledTokens[row.id as string]);
    }
    data.coaches.push(...shared.get("Coach")!);
    data.snapshots.push(...shared.get("CoachdbArchiveSnapshot")!);
    data.rows.push(...shared.get("CoachdbArchiveRow")!);
    await seed("Coach", data.coaches); await seed("CoachdbArchiveSnapshot", data.snapshots); await seed("CoachdbArchiveRow", data.rows);
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const snapshot = async () => {
      const pgHashes = [], mongoHashes = [];
      for (const table of tables) pgHashes.push(digest((await sql.query(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows));
      const collections = await store.db.listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
      for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) mongoHashes.push([name, digest(await store.db.collection(name).find({}).sort({ _id: 1 }).toArray())]);
      return { pgHashes, mongoHashes };
    };
    const assertTokens = async (expected: Map<string, string | null>) => {
      const pgRows = await pgDb.coach.findMany({ select: { id: true, accessToken: true } });
      const mongoRows = (await store.collection("Coach").find({}).toArray()).map(row => decodeMongoRuntimeDocument("Coach", row));
      const sorted = (rows: Array<[string, unknown]>) => rows.sort(([a], [b]) => a.localeCompare(b));
      assert.deepEqual(sorted(pgRows.map(row => [row.id, row.accessToken])), sorted([...expected]));
      assert.deepEqual(sorted(mongoRows.map(row => [row.id as string, row.accessToken])), sorted([...expected]));
    };
    const dry = { archivedTokens: 258 + expectedTokenBackfillDryRun.archivedTokens, missingTokens: 253 + expectedTokenBackfillDryRun.missingTokens, changedTokens: 257 + expectedTokenBackfillDryRun.changedTokens, updatedTokens: 0 };
    const done = { ...expectedTokenBackfillRerun, archivedTokens: 258 + expectedTokenBackfillRerun.archivedTokens };
    console.log(`[token-backfill-pg] migrations=${migrations.length} coaches=${data.coaches.length} archiveRows=${data.rows.length} baseline=1a7323b`);

    await suite.test("dry-run crosses both page boundaries, selects latest non-null/ties/empty exactly and writes nothing", async () => {
      const before = await snapshot();
      assert.deepEqual(await activityContext.run(actor, () => backfillCoachAccessTokens(pgDb, { apply: false })), dry);
      assert.deepEqual(await activityContext.run(actor, () => mongo.backfill({ apply: false })), dry);
      await assertTokens(data.initial); assert.deepEqual(await snapshot(), before);
    });
    await suite.test("apply matches fixed tokens/counts including deleted/inactive; privacy and redacted audit remain real", async () => {
      const before = await snapshot();
      assert.deepEqual(await activityContext.run(actor, () => backfillCoachAccessTokens(pgDb, { apply: true })), { ...dry, updatedTokens: 257 + expectedTokenBackfillApply.updatedTokens });
      assert.deepEqual(await activityContext.run(actor, () => mongo.backfill({ apply: true })), { ...dry, updatedTokens: 257 + expectedTokenBackfillApply.updatedTokens });
      await assertTokens(data.expected);
      const after = await snapshot();
      assert.deepEqual(after.pgHashes.slice(1, 3), before.pgHashes.slice(1, 3), "PG archive stays immutable");
      assert.deepEqual(after.mongoHashes.filter(([name]) => String(name).includes("CoachdbArchive")), before.mongoHashes.filter(([name]) => String(name).includes("CoachdbArchive")), "Mongo archive stays immutable");
      const pgAudits = await pgDb.activityChange.findMany();
      const mongoAudits = (await store.collection("ActivityChange").find({}).toArray()).map(row => decodeMongoRuntimeDocument("ActivityChange", row));
      for (const audits of [pgAudits, mongoAudits]) {
        assert.equal(audits.length, 266);
        assert.equal(new Set(audits.map(row => row.targetId)).size, 266);
        for (const row of audits) {
          assert.deepEqual((row.changes as Record<string, unknown>).access_token, { redacted: true });
          assert.equal(row.requestId, actor.requestId);
        }
      }
      const rawPG = JSON.stringify((await sql.query("SELECT row_to_json(t) FROM coaches t UNION ALL SELECT row_to_json(t) FROM activity_changes t UNION ALL SELECT row_to_json(t) FROM coachdb_archive_rows t")).rows);
      const rawMongo = JSON.stringify(await Promise.all(models.map(model => store.collection(model).find({}).toArray())));
      for (const token of [...data.initial.values(), ...data.expected.values()].filter((value): value is string => !!value)) {
        assert.equal(rawPG.includes(token), false, "PG must not persist plaintext tokens");
        assert.equal(rawMongo.includes(token), false, "Mongo must not persist plaintext tokens");
      }
      for (const [coachId, token] of data.expected) {
        const raw = await store.collection("Coach").findOne({ _id: coachId }); assert.ok(raw);
        assert.equal(raw.accessTokenPiiIndex, token === null ? null : mongoRuntimeBlindIndex("Coach", "accessToken", token));
        assert.equal((raw.updatedAt as Date).getTime() !== (data.coaches.find(row => row.id === coachId)!.updatedAt as Date).getTime(), data.initial.get(coachId) !== token);
      }
    });
    await suite.test("reapply and dry-run after apply return zero changes without timestamp/ciphertext/audit churn", async () => {
      const before = await snapshot();
      for (const apply of [false, true]) {
        assert.deepEqual(await backfillCoachAccessTokens(pgDb, { apply }), done);
        assert.deepEqual(await mongo.backfill({ apply }), done);
      }
      assert.deepEqual(await snapshot(), before);
    });
    await suite.test("late duplicate unique token rolls back the earlier update, timestamps and attributed audit on both databases", async () => {
      await seed("Coach", [
        coachFixtureRow("Coach", { id: id(500), sourceCoachId: "parity-rollback-first", accessToken: null, updatedAt: day(1) }),
        coachFixtureRow("Coach", { id: id(501), sourceCoachId: "parity-rollback-last", accessToken: null, updatedAt: day(1) })
      ]);
      await seed("CoachdbArchiveRow", [
        coachFixtureRow("CoachdbArchiveRow", { id: id(9500), snapshotId: id(1000), tableSchema: "public", tableName: "coaches", rowKey: "parity-rollback-first", rowData: { access_token: "parity-rollback-new" } }),
        coachFixtureRow("CoachdbArchiveRow", { id: id(9501), snapshotId: id(1000), tableSchema: "public", tableName: "coaches", rowKey: "parity-rollback-last", rowData: { access_token: "parity-unchanged" } })
      ]);
      const before = await snapshot();
      // Dry-run reports candidates without inventing an apply-time uniqueness check.
      const collisionDry = { archivedTokens: 270, missingTokens: 2, changedTokens: 2, updatedTokens: 0 };
      assert.deepEqual(await backfillCoachAccessTokens(pgDb, { apply: false }), collisionDry);
      assert.deepEqual(await mongo.backfill({ apply: false }), collisionDry);
      await assert.rejects(activityContext.run(actor, () => backfillCoachAccessTokens(pgDb, { apply: true })));
      await assert.rejects(activityContext.run(actor, () => mongo.backfill({ apply: true })));
      assert.deepEqual(await snapshot(), before, "no committed prefix or audit may survive the duplicate");
    });
  } finally {
    try { if (db) await db.$disconnect(); }
    finally {
      try { if (sqlConnected) await sql.end(); }
      finally {
        try {
          if (mongoConnected) {
            assert.match(namespace, /^shadow_token_pg_[a-f0-9]{16}$/);
            const owned = await client.db(options.databaseName).listCollections({ name: { $regex: `^${namespace}_` } }, { nameOnly: true }).toArray();
            for (const collection of owned) { assert.ok(collection.name.startsWith(`${namespace}_`)); await client.db(options.databaseName).collection(collection.name).drop(); }
          }
        } finally { await client.close(); for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
      }
    }
  }
});
