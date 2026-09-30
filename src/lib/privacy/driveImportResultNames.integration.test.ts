import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { migratePersonalData, enforcePersonalData } from "../../../scripts/encrypt-personal-data";
import { encryptField, indexField } from "./fields";
import { PrismaDriveImportHistoryRepository } from "../data/prismaDriveImportHistoryRepository";

const url = process.env.PII_DRIVE_SNAPSHOT_TEST_DATABASE_URL;
const TARGET = "20260930150000_encrypt_drive_import_result_names";
const runId = "10000000-0000-4000-8000-000000000001";
const names = [
  ["가상 사람 기업", "가상 사람 과정"],
  ["A-person", "z-person"],
  ["Z-person", "A-person"],
  ["A-person", "A-person-course"]
] as const;

test("Drive result snapshot names: legacy transition, retry, keys, ordering and plaintext exclusion on PostgreSQL", { skip: !url, timeout: 240_000 }, async () => {
  const parsed = new URL(url!);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.pathname, "/snapshot_privacy_test");
  const envNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS", "DATABASE_URL"];
  const saved = new Map(envNames.map(name => [name, process.env[name]]));
  const keys = { encryption: JSON.stringify({ snapshot_fixture: randomBytes(32).toString("base64") }), index: randomBytes(32).toString("base64") };
  Object.assign(process.env, { DATABASE_URL: url, PII_ENCRYPTION_KEYS: keys.encryption, PII_ACTIVE_KEY_ID: "snapshot_fixture",
    PII_INDEX_KEY: keys.index, PII_ALLOW_PLAINTEXT_READS: "false" });
  const sql = new pg.Client({ connectionString: url });
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, options: "-c timezone=UTC" }) });
  let db: PrismaClient | undefined;
  await sql.connect();
  try {
    await sql.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const root = path.resolve("prisma/migrations");
    const migrations = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.equal(migrations.at(-1), TARGET);
    for (const name of migrations.slice(0, -1)) await sql.query(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
    await sql.query("INSERT INTO drive_import_runs(id, mode, status, operation_count, started_at) VALUES ($1, 'scan', 'completed', 3, '2099-01-01T00:00:00Z')", [runId]);
    for (const [index, [company, course]] of names.entries()) await sql.query(
      "INSERT INTO drive_import_results(id,run_id,operation_id,company_name,course_name,input_kind,result_kind,candidate_count,created_at) VALUES ($1,$2,$3,$4,$5,'driveLink','scan_no_folder',10,$6)",
      [randomUUID(), runId, `SYNTHETIC-${index}`, company, course, new Date(Date.UTC(2099, 0, index + 1))]);

    await assert.rejects(migratePersonalData(raw, true), /company_name_pii_index|course_name_pii_index/);
    assert.equal((await sql.query("SELECT count(*)::int n FROM drive_import_results WHERE company_name LIKE 'pii:v1:%' OR course_name LIKE 'pii:v1:%'")).rows[0].n, 0);

    await sql.query(readFileSync(path.join(root, TARGET, "migration.sql"), "utf8"));
    await sql.query("UPDATE drive_import_results SET company_name=$1,course_name=$2,company_name_pii_index=$3,course_name_pii_index=$4 WHERE operation_id='SYNTHETIC-0'", [
      encryptField("DriveImportResult", "companyName", names[0][0]), encryptField("DriveImportResult", "courseName", names[0][1]),
      indexField("DriveImportResult", "companyName", names[0][0]), indexField("DriveImportResult", "courseName", names[0][1])
    ]);
    const dry = await migratePersonalData(raw, false);
    assert.equal(dry.drive_import_results.plaintext, (names.length - 1) * 2); assert.equal(dry.drive_import_results.encrypted, 2);
    assert.equal((await sql.query("SELECT count(*)::int n FROM drive_import_results WHERE company_name_pii_index IS NOT NULL OR course_name_pii_index IS NOT NULL")).rows[0].n, 1);

    const { getPrismaClient } = await import("../data/prisma");
    db = getPrismaClient();
    await assert.rejects(db.driveImportResult.findFirstOrThrow({ where: { runId } }), /Unencrypted personal data/);

    const applied = await migratePersonalData(raw, true);
    assert.equal(applied.drive_import_results.plaintext, (names.length - 1) * 2); assert.equal(applied.drive_import_results.encrypted, 2);
    const stored = await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text");
    for (const row of stored.rows) {
      assert.match(row.company_name, /^pii:v1:/); assert.match(row.course_name, /^pii:v1:/);
      assert.match(row.company_name_pii_index, /^[a-f0-9]{64}$/); assert.match(row.course_name_pii_index, /^[a-f0-9]{64}$/);
    }
    for (const [company, course] of names) { const rawText = JSON.stringify(stored.rows); assert.equal(rawText.includes(company), false); assert.equal(rawText.includes(course), false); }

    const rerun = await migratePersonalData(raw, true);
    assert.equal(rerun.drive_import_results.plaintext, 0); assert.equal(rerun.drive_import_results.invalidIndexes, 0);
    assert.deepEqual((await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text")).rows, stored.rows);

    await sql.query("UPDATE drive_import_results SET company_name_pii_index=NULL WHERE operation_id='SYNTHETIC-0'");
    assert.equal((await migratePersonalData(raw, false)).drive_import_results.invalidIndexes, 1);
    assert.equal((await migratePersonalData(raw, true)).drive_import_results.invalidIndexes, 1);
    assert.equal((await migratePersonalData(raw, false)).drive_import_results.invalidIndexes, 0);

    process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ snapshot_fixture: randomBytes(32).toString("base64") });
    await assert.rejects(migratePersonalData(raw, false));
    process.env.PII_ENCRYPTION_KEYS = keys.encryption; process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
    assert.ok((await migratePersonalData(raw, false)).drive_import_results.invalidIndexes > 0);
    const beforeWrongKeyApply = await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text");
    const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    assert.equal(errorText(new Error("가상 사람 기업")).includes("가상 사람"), true, "negative control");
    await assert.rejects(migratePersonalData(raw, true), error => !errorText(error).includes("가상 사람") && /index mismatch/i.test(errorText(error)));
    assert.deepEqual((await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text")).rows, beforeWrongKeyApply.rows);
    await assert.rejects(enforcePersonalData(raw));
    process.env.PII_INDEX_KEY = keys.index;

    await sql.query("UPDATE drive_import_results SET company_name_pii_index=$1 WHERE operation_id='SYNTHETIC-0'", ["f".repeat(64)]);
    const beforeTamperedApply = await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text");
    assert.ok((await migratePersonalData(raw, false)).drive_import_results.conflictingIndexes > 0);
    await assert.rejects(migratePersonalData(raw, true), /index mismatch/i);
    assert.deepEqual((await sql.query("SELECT id::text,company_name,course_name,company_name_pii_index,course_name_pii_index FROM drive_import_results ORDER BY id::text")).rows, beforeTamperedApply.rows);
    await sql.query("UPDATE drive_import_results SET company_name_pii_index=NULL WHERE operation_id='SYNTHETIC-0'");
    await migratePersonalData(raw, true);

    const ordered = await db.driveImportRun.findUniqueOrThrow({ where: { id: runId }, include: { results: {
      orderBy: [{ candidateCount: "desc" }, { companyName: "asc" }, { courseName: "asc" }], take: 2
    } } });
    assert.deepEqual(ordered.results.map(row => [row.companyName, row.courseName]), [["A-person", "A-person-course"], ["A-person", "z-person"]]);
    assert.equal((await db.driveImportResult.findMany({ where: { companyName: "가상 사람 기업" } })).length, 1);
    const history = new PrismaDriveImportHistoryRepository();
    const sorted = [["A-person", "A-person-course"], ["A-person", "z-person"], ["Z-person", "A-person"], ["가상 사람 기업", "가상 사람 과정"]];
    for (const [take, expected] of [[1.5, sorted.slice(0, 1)], [-1, sorted.slice(-1)], [-1.5, sorted.slice(-1)], [-2, sorted.slice(-2)], [0.5, []], [-0.5, []], [Number.MAX_SAFE_INTEGER, sorted], [-Number.MAX_SAFE_INTEGER, sorted]] as const) {
      assert.deepEqual((await history.readLatestDriveImportRun(take))?.results.map(row => [row.companyName, row.courseName]), expected);
    }
    for (const take of [Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1, 1e18, -1e18, Number.MAX_VALUE, NaN, Infinity, -Infinity]) {
      assert.equal(await history.readLatestDriveImportRun(take), null);
    }
    const duplicate = await db.driveImportResult.create({ data: { runId, operationId: "SYNTHETIC-DUPLICATE", companyName: "A-person", courseName: "z-person",
      inputKind: "driveLink", resultKind: "scan_no_folder", candidateCount: 10 } });
    assert.equal(duplicate.companyName, "A-person");

    await enforcePersonalData(raw);
    await assert.rejects(sql.query("INSERT INTO drive_import_results(id,run_id,operation_id,company_name,course_name,input_kind,result_kind) VALUES ($1,$2,'PLAIN','plain-person','plain-course','driveLink','scan_no_folder')", [randomUUID(), runId]),
      (error: { code?: string; constraint?: string }) => error.code === "23514" && error.constraint === "pii_encrypted_storage");
  } finally {
    try { await db?.$disconnect(); await raw.$disconnect(); await sql.end(); }
    finally { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
  }
});
