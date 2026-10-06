/** Original PG ONLY. Observation gate, not current/native/page acceptance. Parent owns execution. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { PrismaClient } from "@prisma/client";
import { frozen, verifyClosure } from "./frozen-loader.fixture.ts";

type Row = Record<string, unknown>;
interface View extends Row { results: Row[] }
interface Reader { readLatestDriveImportRun(take?: number): Promise<View | null> }
type TakeTag = { kind: "omitted" | "undefined" | "nan" | "infinity" | "negative-infinity" | "negative-zero" } | { kind: "number"; value: number };
const url = "postgresql://synthetic@127.0.0.1:56750/drive_history_test";
const root = "/private/tmp/hub-om-drive-import-history-20260930/";
const runId = "00000000-0000-4000-8000-000000000001";
const at = "2031-01-02T03:04:05.000Z";
const rowKeys = ["candidateCount", "companyName", "courseName", "createdAt", "endDate", "error", "fileCount", "folderCandidates", "folderTitle", "folderUrl", "inputKind", "inputValue", "issues", "keyCandidates", "operationId", "resultKind", "startDate"].sort();
const literalRun = {
  avgSatisfactionCandidateCount: 7, errorCount: 11, finishedAt: "", folderSearchCount: 5,
  folderSearchWithCandidatesCount: 6, id: runId, instructorCandidateCount: 9,
  instructorSatisfactionCandidateCount: 8, mode: "dry_run", operationCount: 901,
  scanFoundFolderCount: 3, scanIssueCount: 4, scannedRefCount: 2, startedAt: at,
  status: "PENDING", suspiciousCandidateCount: 10
};
const literalRow = (id: string, company: string, course: string, count: number): Row => ({
  candidateCount: count, companyName: company, courseName: course, createdAt: at, endDate: "", error: "",
  fileCount: 0, folderCandidates: [], folderTitle: "", folderUrl: "", inputKind: "gate", inputValue: "",
  issues: [], keyCandidates: [], operationId: id, resultKind: "gate", startDate: ""
});
function decode(tag: TakeTag): number | undefined {
  if (tag.kind === "number") return tag.value;
  if (tag.kind === "nan") return NaN;
  if (tag.kind === "infinity") return Infinity;
  if (tag.kind === "negative-infinity") return -Infinity;
  if (tag.kind === "negative-zero") return -0;
  return undefined;
}
async function send(value: unknown) {
  assert.ok(process.send, "parent IPC required");
  await new Promise<void>((resolve, reject) => process.send!(value, error => error ? reject(error) : resolve()));
}
async function main() {
  verifyClosure();
  assert.equal(process.env.PG_DRIVE_HISTORY_TEST_DATABASE_URL, url);
  const dataDirectory = process.env.PG_DRIVE_HISTORY_TEST_DATA_DIRECTORY;
  assert.ok(dataDirectory?.startsWith(root) && !dataDirectory.slice(root.length).includes("..") && dataDirectory.length > root.length, "explicit owned data_directory required");
  for (const name of ["DATABASE_URL", "DIRECT_URL", "MONGODB_URI", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY"]) assert.equal(process.env[name], undefined, `inherited ${name} forbidden`);
  Object.assign(process.env, { DATABASE_URL: url, TZ: "UTC", PII_ACTIVE_KEY_ID: "gate",
    PII_ENCRYPTION_KEYS: JSON.stringify({ gate: randomBytes(32).toString("base64") }),
    PII_INDEX_KEY: randomBytes(32).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
  globalThis.fetch = async () => { throw new Error("DRIVE_GATE_EXTERNAL_FETCH_FORBIDDEN"); };
  const tags = JSON.parse(process.argv[2]) as TakeTag[];
  assert.ok(Array.isArray(tags) && tags.length > 0);
  const sql = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 15_000, options: "-c timezone=UTC -c statement_timeout=15000" });
  let connected = false, owned = false, prisma: PrismaClient | undefined;
  const observations: Row[] = [];
  try {
    await sql.connect(); connected = true;
    assert.deepEqual((await sql.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port")).rows, [{ db: "drive_history_test", usr: "synthetic", port: 56750 }]);
    assert.equal((await sql.query("SHOW data_directory")).rows[0].data_directory, dataDirectory);
    assert.equal((await sql.query("SELECT pg_try_advisory_lock(73137056750::bigint) AS owned")).rows[0].owned, true);
    // Coordinator has migrated this fresh synthetic DB. Never drop its schema.
    assert.deepEqual((await sql.query("SELECT (SELECT count(*)::int FROM drive_import_runs) AS runs,(SELECT count(*)::int FROM drive_import_results) AS results")).rows, [{ runs: 0, results: 0 }]);
    owned = true;
    prisma = (await frozen<{ getPrismaClient(): PrismaClient }>("src/lib/data/prisma.ts")).getPrismaClient();
    const reader = await frozen<Reader>("src/lib/driveImports/driveImportResults.ts");
    const database = (await sql.query("SELECT version() AS server, to_jsonb(d) AS database, pg_database_collation_actual_version(d.oid) AS actual_version FROM pg_database d WHERE datname=current_database()")).rows;
    const columns = (await sql.query(`SELECT a.attname, a.attcollation, to_jsonb(c) AS collation,
      pg_collation_actual_version(c.oid) AS actual_version FROM pg_attribute a
      JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_collation c ON c.oid=a.attcollation
      WHERE n.nspname='public' AND t.relname='drive_import_results' AND a.attname IN ('company_name','course_name') ORDER BY a.attname`)).rows;
    assert.equal(columns.length, 2);
    await send({ kind: "observation", phase: "collation", database, columns, note: "Read only; provider/locale/version/default or column override preserved, never tuned." });
    await sql.query(`INSERT INTO drive_import_runs(id,mode,status,operation_count,scanned_ref_count,scan_found_folder_count,scan_issue_count,folder_search_count,folder_search_with_candidates_count,avg_satisfaction_candidate_count,instructor_satisfaction_candidate_count,instructor_candidate_count,suspicious_candidate_count,error_count,started_at)
      VALUES($1,'dry_run','pending',901,2,3,4,5,6,7,8,9,10,11,$2)`, [runId, at]);
    const expected = new Map<string, Row>();
    async function seed(rows: Array<[string, string, string, number]>) {
      await sql.query("DELETE FROM drive_import_results WHERE run_id=$1", [runId]); expected.clear();
      for (const [i, [id, company, course, count]] of rows.entries()) {
        const uuid = `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`;
        await sql.query(`INSERT INTO drive_import_results(id,run_id,operation_id,company_name,course_name,input_kind,result_kind,candidate_count,created_at)
          VALUES($1,$2,$3,$4,$5,'gate','gate',$6,$7)`, [uuid, runId, id, company, course, count, at]);
        expected.set(id, literalRow(id, company, course, count));
      }
      const actual = (await sql.query("SELECT operation_id,company_name,course_name,candidate_count,operation_session_id,input_value,key_candidates FROM drive_import_results WHERE run_id=$1 ORDER BY operation_id", [runId])).rows;
      assert.equal(actual.length, rows.length);
      for (const row of actual) {
        const value = expected.get(row.operation_id); assert.ok(value);
        assert.equal(row.company_name, value.companyName); assert.equal(row.course_name, value.courseName); assert.equal(row.candidate_count, value.candidateCount);
        assert.equal(row.operation_session_id, null); assert.equal(row.input_value, null); assert.equal(row.key_candidates, null);
      }
    }
    function checkDto(view: View | null): string[] | null {
      if (view === null) return null;
      assert.deepEqual(Object.keys(view).sort(), [...Object.keys(literalRun), "results"].sort());
      const { results, ...header } = view; assert.deepEqual(header, literalRun); assert.ok(Array.isArray(results));
      for (const row of results) { assert.deepEqual(Object.keys(row).sort(), rowKeys); assert.deepEqual(row, expected.get(String(row.operationId))); }
      const ids = results.map(row => String(row.operationId)); assert.equal(new Set(ids).size, ids.length); return ids;
    }
    // Distinct primary sort keys give independent literal rank/order, no shared comparator.
    const ranked: Array<[string, string, string, number]> = Array.from({ length: 253 }, (_, i) => [`rank-${String(i).padStart(3, "0")}`, "same-company", "same-course", 1000 - i]);
    await seed(ranked);
    for (const tag of tags) {
      const value = decode(tag);
      if (tag.kind === "nan") assert.ok(Number.isNaN(value));
      else if (tag.kind === "infinity") assert.equal(value, Infinity);
      else if (tag.kind === "negative-infinity") assert.equal(value, -Infinity);
      else if (tag.kind === "negative-zero") assert.ok(Object.is(value, -0));
      else if (tag.kind === "undefined" || tag.kind === "omitted") assert.equal(value, undefined);
      const view = tag.kind === "omitted" ? await reader.readLatestDriveImportRun() : await reader.readLatestDriveImportRun(value);
      const identities = checkDto(view);
      if (tag.kind === "omitted" || tag.kind === "undefined") assert.deepEqual(identities, ranked.slice(0, 250).map(row => row[0]));
      if (tag.kind === "number" && Number.isInteger(tag.value) && tag.value >= 0 && tag.value <= 251) assert.deepEqual(identities, ranked.slice(0, tag.value).map(row => row[0]));
      // Negative/malformed outcomes are deliberately observed, not guessed or declared parity.
      const observed = { phase: "take", tag, restored: { type: typeof value, printable: String(value), nan: Number.isNaN(value), negativeZero: Object.is(value, -0) }, outcome: view === null ? "null" : "dto", identities };
      observations.push(observed); await send({ kind: "observation", ...observed });
    }
    const names = ["A", "a", "Z", "z", "á", "a\u0301", "Ä", "ä", "가", "각", "나", "", " ", "a-", "a0", "a10", "a2"];
    const collated: Array<[string, string, string, number]> = names.flatMap((name, i) => [
      [`company-${i}`, name, "same-course", 10] as [string,string,string,number],
      [`course-${i}`, "same-company", name, 9] as [string,string,string,number]
    ]);
    await seed(collated);
    const sqlOrder = (await sql.query("SELECT operation_id FROM drive_import_results WHERE run_id=$1 ORDER BY candidate_count DESC, company_name ASC, course_name ASC", [runId])).rows.map(row => row.operation_id);
    const equalPairs = (await sql.query(`SELECT a.operation_id AS a,b.operation_id AS b FROM drive_import_results a JOIN drive_import_results b
      ON a.run_id=b.run_id AND a.id<b.id AND a.candidate_count=b.candidate_count AND a.company_name=b.company_name AND a.course_name=b.course_name WHERE a.run_id=$1 ORDER BY a.operation_id,b.operation_id`, [runId])).rows;
    const collatedIds = checkDto(await reader.readLatestDriveImportRun(251)); assert.ok(collatedIds);
    // If collation-equal strings exist, preserve exact membership and compare rank groups.
    const groups = (await sql.query("SELECT operation_id,dense_rank() OVER(ORDER BY candidate_count DESC,company_name ASC,course_name ASC)::int AS rank FROM drive_import_results WHERE run_id=$1", [runId])).rows;
    const ranks = new Map(groups.map(row => [row.operation_id as string, row.rank as number]));
    assert.deepEqual([...collatedIds].sort(), [...sqlOrder].sort());
    assert.deepEqual(collatedIds.map(id => ranks.get(id)), [...collatedIds.map(id => ranks.get(id)!)].sort((a,b) => a-b));
    await send({ kind: "observation", phase: "collation-order", rows: collated, sqlOrder, identities: collatedIds, equalPairs, groups });
    // Negative take tie-cut: capture actual selected identity + output order separately.
    await seed(Array.from({ length: 6 }, (_, i) => [`tie-${i}`, "same", "same", i < 2 ? 20 : 10]));
    for (const take of [-1, -3, -6]) await send({ kind: "observation", phase: "negative-tie", take, identities: checkDto(await reader.readLatestDriveImportRun(take)), fixture: [...expected.values()] });
    await send({ kind: "result", status: "ORIGINAL_OBSERVATIONS_ONLY_REVIEW_REQUIRED", takeCases: observations.length, pageExecuted: false, currentExecuted: false, nativeExecuted: false });
  } finally {
    try { await prisma?.$disconnect(); }
    finally {
      if (connected) {
        try {
          if (owned) {
            await sql.query("DELETE FROM drive_import_runs WHERE id=$1", [runId]);
            assert.deepEqual((await sql.query("SELECT (SELECT count(*)::int FROM drive_import_runs WHERE id=$1) AS runs,(SELECT count(*)::int FROM drive_import_results WHERE run_id=$1) AS results", [runId])).rows, [{ runs: 0, results: 0 }]);
            await send({ kind: "cleanup", ownedRuns: 0, ownedResults: 0, note: "Deleted only fixed owned run and cascading results. Schema/migrations/server/dbpath retained for coordinator." });
          }
        } finally { await sql.end(); }
      }
    }
  }
}
main().catch(async error => { await send({ kind: "failure", message: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; });
