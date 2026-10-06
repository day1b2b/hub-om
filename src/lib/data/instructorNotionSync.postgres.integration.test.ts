import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { mock, test } from "node:test";
import pg from "pg";
import { MongoClient } from "mongodb";
import { getPrismaClient } from "./prisma";
import { PrismaInstructorNotionSyncRepository } from "./prismaInstructorNotionSyncRepository";
import { MongoInstructorNoteRepository, INSTRUCTOR_NOTE_MODELS } from "./mongoInstructorNoteRepository";
import { MongoOperationStore, completeMongoRow, type MongoRow } from "./mongoOperationStore";
import { encodeMongoRuntimeDocument, MongoDbNull, MongoJsonNull } from "./mongoRuntimeCodec";
import { prepareMongoReadStore } from "./mongoReadStore";
import { originalSyncNotionInstructors } from "./instructorNotionSyncOriginalOracle.fixture";
import { runNotionInstructorSync } from "../instructors/instructorNotionSyncWorkflow";
import { activityContext } from "../activity/context";
import type { JsonObject } from "../instructors/notionInstructorMap";

const pgUrl = process.env.INSTRUCTOR_NOTION_PG_TEST_DATABASE_URL;
const mongoUri = process.env.MONGODB_INSTRUCTOR_NOTION_TEST_URI;
const id = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, "0")}`;
const initialDate = new Date("2020-01-01T00:00:00.000Z"), now = Date.parse("2099-01-01T00:00:00.000Z");
const text = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
function page(no: number, name = "Synthetic instructor", avoid = false, pageId?: string): JsonObject {
  return { ...(pageId === undefined ? {} : { id: pageId }), properties: {
    "강사명": { type: "title", title: [{ plain_text: name }] }, "ID": { type: "unique_id", unique_id: { number: no } },
    "섭외지양 여부": { type: "checkbox", checkbox: avoid }, "소속정보": text("Synthetic private affiliation"),
    "메모": text("Synthetic profile memo private@example.invalid 010-1234-5678"),
    "이메일 주소": { type: "email", email: "private@example.invalid" }, "생년월일": text("2000-01-01")
  } };
}
function seed(n: number, fields: MongoRow = {}): MongoRow {
  return completeMongoRow("InstructorNote", { id: id(n), instructorName: "Synthetic instructor", recruitAvoid: false,
    createdAt: initialDate, updatedAt: initialDate, ...fields });
}
type Scenario = { name: string; seeds: MongoRow[]; pages: JsonObject[] };
const scenarios: Scenario[] = [
  { name: "new, repeated source and skip", seeds: [], pages: [page(1), page(1), {}, page(2, "Synthetic second")] },
  { name: "NO priority over same-name legacy and name update", seeds: [seed(1, { notionNo: 1, instructorName: "Synthetic old", displayName: "Synthetic display", notes: "Synthetic manual memo", partnerId: "Synthetic partner", notionId: "Synthetic old id" }), seed(2)], pages: [page(1)] },
  { name: "legacy link, truthy page id and profile replacement", seeds: [seed(1, { notionId: "Synthetic old id", notionProfile: { memo: "Synthetic old profile", categories: ["Old"] }, notes: "", displayName: "", partnerId: "" })], pages: [page(3, "Synthetic instructor", false, "Aa-bb-cc")] },
  { name: "numbered same name not legacy; case and interior whitespace exact", seeds: [seed(1, { notionNo: 5 })], pages: [page(6), page(7, "synthetic instructor"), page(8, "Synthetic  instructor"), page(9, " Synthetic instructor ")] },
  { name: "empty page id preserves saved link", seeds: [seed(1, { notionNo: 1, notionId: "Synthetic saved id" })], pages: [page(1, "Synthetic instructor", false, "")] },
  { name: "invalid row between two successes", seeds: [], pages: [page(1), page(2147483648, "Synthetic rejected"), page(2, "Synthetic later")] },
  { name: "missing and wrong-type NO are mapper skips", seeds: [], pages: [{}, { properties: { "강사명": { type: "title", title: [{ plain_text: "Synthetic" }] }, "ID": { type: "unique_id", unique_id: { number: "1" } } } }] }
];
for (const current of [false, true]) for (const incoming of [false, true]) scenarios.push({ name: `OR ${current}/${incoming}`, seeds: [seed(1, { notionNo: 1, recruitAvoid: current })], pages: [page(1, "Synthetic instructor", incoming)] });
for (const no of [0, -1, 0.5, -0.5, 1.5, -1.5, 2147483647, -2147483648, 2147483647.5, -2147483648.5, 2147483648, -2147483649, NaN, Infinity, -Infinity]) {
  scenarios.push({ name: `numeric empty ${String(no)}`, seeds: [], pages: [page(no)] });
  scenarios.push({ name: `numeric legacy ${String(no)}`, seeds: [seed(1)], pages: [page(no)] });
}
const digest = (path: string) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
test("frozen instructor oracle and unchanged mapping/PII policy checksums", () => {
  assert.equal(digest("./instructorNotionSyncOriginalOracle.fixture.ts"), "91f564d6644362655f3cb4aee46a362f61918bca6e256669be9b9f3ff8457633");
  assert.equal(digest("../instructors/notionInstructorMap.ts"), "51e92992c1eb726f085ef72fc298b1926bd9f618ddfc4c428b2258fe3fc07bef");
  assert.equal(digest("./instructorNotePii.ts"), "105b9f69ed6cb915dc3f96286ff406ba3f692a8efa13456f6582d6afc3406eb8");
});
function scalar(value: unknown): unknown {
  if (value === MongoDbNull || value === MongoJsonNull) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scalar);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scalar(v)]));
  return value;
}

test("real PG frozen/newPG/Mongo instructor workflow and audit parity", { skip: !pgUrl || !mongoUri, timeout: 240_000 }, async suite => {
  assert.equal(pgUrl, "postgresql://synthetic@127.0.0.1:56689/instructor_notion_parity");
  assert.equal(mongoUri, "mongodb://127.0.0.1:27789/?replicaSet=instructornotion20260929");
  const envNames = ["DATABASE_URL", "OPERATION_DATA_SOURCE", "PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"];
  const saved = new Map(envNames.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: pgUrl, OPERATION_DATA_SOURCE: "postgres", PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: randomBytes(32).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: pgUrl }), client = new MongoClient(mongoUri!, { serverSelectionTimeoutMS: 5000 });
  const options = { client, databaseName: `hub_om_shadow_instructor_pg_${randomBytes(8).toString("hex")}`, namespace: "shadow_parity", allowShadowWrites: true as const };
  let prisma: ReturnType<typeof getPrismaClient> | undefined, pgConnected = false, mongoConnected = false;
  mock.timers.enable({ apis: ["Date"], now });
  try {
    await sql.connect(); pgConnected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr")).rows[0], { db: "instructor_notion_parity", usr: "synthetic" });
    await sql.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.length, 45);
    for (const migration of migrations) await sql.query(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
    prisma = getPrismaClient(); const db = prisma;
    await client.connect(); mongoConnected = true;
    assert.equal((await client.db("admin").command({ hello: 1 })).setName, "instructornotion20260929");
    await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
    const mongo = await MongoInstructorNoteRepository.open(options), adapter = new PrismaInstructorNotionSyncRepository(), store = new MongoOperationStore(options, INSTRUCTOR_NOTE_MODELS);
    const expected = new Map<string, unknown>();
    for (const backend of ["original", "pg", "mongo"] as const) await suite.test(backend, async () => {
      let phaseCount = 0;
      for (const scenario of scenarios) {
        await sql.query("TRUNCATE instructor_notes,activity_changes");
        for (const model of INSTRUCTOR_NOTE_MODELS) await store.collection(model).deleteMany({});
        for (const original of scenario.seeds) {
          // Explicit synthetic complete rows; JSON DB null differs from Prisma input null.
          const row = { ...original }; if (row.notionProfile === MongoDbNull) delete row.notionProfile;
          if (backend === "mongo") await store.collection("InstructorNote").insertOne(encodeMongoRuntimeDocument("InstructorNote", original));
          else await db.instructorNote.create({ data: row as Parameters<typeof db.instructorNote.create>[0]["data"] });
        }
        const raw = async () => backend === "mongo" ? [await store.collection("InstructorNote").find({}).sort({ _id: 1 }).toArray(), await store.collection("ActivityChange").find({}).sort({ _id: 1 }).toArray()]
          : [(await sql.query("SELECT * FROM instructor_notes ORDER BY id")).rows, (await sql.query("SELECT * FROM activity_changes ORDER BY id")).rows];
        for (const phase of ["preview", "apply", "reapply"] as const) {
          const before = await raw(), requestId = randomUUID();
          const result = await activityContext.run({ requestId, actorEmail: "synthetic-parity@example.invalid", actorName: "Synthetic parity actor", actorType: "user", route: "/api/admin/sync-notion-instructors", method: phase === "preview" ? "GET" : "POST" }, () => backend === "original"
            ? originalSyncNotionInstructors(scenario.pages, db, phase === "preview") : runNotionInstructorSync(scenario.pages, backend === "pg" ? adapter : mongo, phase === "preview"));
          assert.equal(result.created + result.updated + result.skipped + result.errors, result.totalRows);
          if (backend !== "original") assert.deepEqual(result.errorDetail, Array(result.errors).fill("INSTRUCTOR_NOTION_ROW_FAILED"));
          else { assert.equal(result.errorDetail.length, result.errors); for (const message of result.errorDetail) assert.match(message, /^NO /); }
          const rows: MongoRow[] = backend === "mongo" ? await store.scan("InstructorNote") : await db.instructorNote.findMany();
          const identities = new Map(rows.map(row => [row.id, scenario.seeds.some(seed => seed.id === row.id) ? row.id : `new:${row.notionNo}`]));
          const logicalRows = rows.map(row => {
            assert.ok(row.createdAt instanceof Date); assert.ok(row.updatedAt instanceof Date);
            if (scenario.seeds.some(seed => seed.id === row.id)) assert.deepEqual(row.createdAt, initialDate);
            const logical = Object.fromEntries(Object.entries(row).filter(([field]) => !field.endsWith("PiiIndex")));
            return scalar({ ...logical, id: identities.get(row.id), createdAt: scenario.seeds.some(seed => seed.id === row.id) ? initialDate : "generated-date", updatedAt: "generated-date" });
          }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
          const audits: MongoRow[] = backend === "mongo" ? await store.scan("ActivityChange", { requestId }) : await db.activityChange.findMany({ where: { requestId } });
          const logicalAudits = audits.map(row => scalar({ targetId: identities.get(row.targetId), targetType: row.targetType, action: row.action,
            changes: row.changes, actorEmail: row.actorEmail, actorName: row.actorName, actorType: row.actorType, route: row.route, method: row.method })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
          // JSON object key order is not semantic; array order is preserved.
          const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
          const summary = canonical({ result: { ...result, errorDetail: result.errorDetail.map(() => "row-error") }, rows: logicalRows, audits: logicalAudits });
          const key = `${scenario.name}/${phase}`;
          if (backend === "original") expected.set(key, summary); else assert.deepEqual(summary, expected.get(key), `${backend} ${key}`);
          if (phase === "preview") assert.deepEqual(await raw(), before, `${backend} ${key} no writes`);
          const storedSnapshot = await raw();
          for (const row of rows) {
            const stored = storedSnapshot[0].find((candidate: MongoRow) => (candidate.id ?? candidate._id) === row.id);
            assert.ok(stored);
            for (const field of ["instructorName", "displayName", "notionId", "partnerId", "notes"]) {
              const indexName = backend === "mongo" ? `${field}PiiIndex` : `${field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}_pii_index`;
              assert.ok(Object.hasOwn(stored, indexName));
              const expectedIndex = row[field] == null ? null : createHmac("sha256", Buffer.from(process.env.PII_INDEX_KEY!, "base64")).update(`InstructorNote.${field}`).update("\0").update(String(row[field])).digest("hex");
              assert.equal(stored[indexName], expectedIndex);
            }
          }
          const serialized = JSON.stringify(storedSnapshot);
          for (const secret of ["Synthetic instructor", "Synthetic manual memo", "Synthetic private affiliation", "synthetic-parity@example.invalid", "private@example.invalid"]) assert.ok(!serialized.includes(secret), `${backend} encrypted storage`);
          for (const row of rows) {
            const profile = row.notionProfile;
            if (profile && typeof profile === "object") {
              assert.ok(!Object.hasOwn(profile, "email")); assert.ok(!Object.hasOwn(profile, "birthDate"));
            }
          }
          phaseCount++;
        }
      }
      assert.equal(phaseCount, scenarios.length * 3);
      console.log(`${backend}: ${phaseCount} scenario phases; result, row, audit and raw privacy verified`);
    });
  } finally {
    try { if (mongoConnected) await client.db(options.databaseName).dropDatabase(); }
    finally { try { await client.close(); if (prisma) await prisma.$disconnect(); if (pgConnected) await sql.query("TRUNCATE instructor_notes,activity_changes"); await sql.end(); }
      finally { mock.timers.reset(); for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } }
  }
});
