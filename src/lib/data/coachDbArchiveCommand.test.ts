import assert from "node:assert/strict";
import test from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { parseCoachDbArchiveArgs, runCoachDbArchiveCommand } from "./coachDbArchiveCommand";
const input = { sourceDatabase: "configured-postgresql-source", sourceSchema: "public" as const,
  tables: [{ schema: "public", name: "coaches", rowCount: 1, rows: [{ rowKey: "private-key", rowData: { name: "Private Name" } }] }] };
test("coach db archive arguments are explicit", () => {
  assert.deepEqual(parseCoachDbArchiveArgs([]), { apply: false }); assert.deepEqual(parseCoachDbArchiveArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseCoachDbArchiveArgs(["--apply"]), { apply: true }); assert.throws(() => parseCoachDbArchiveArgs(["--apply", "--dry-run"])); assert.throws(() => parseCoachDbArchiveArgs(["--unknown"]));
});
test("coach db archive command reads counts for dry-run and rows for apply without raw errors", async () => {
  const seen: boolean[] = [], repository = { async archive(value: typeof input) { assert.deepEqual(value, input); return { tableCount: 1, rowCount: 1, tables: [{ schema: "public", name: "coaches", rowCount: 1 }] }; } };
  await runWithDataRepositories({ coachDbArchive: repository }, async () => {
    await runCoachDbArchiveCommand([], { COACH_DB_DATABASE_URL: "synthetic" }, () => { throw new Error("must stay closed"); }, { readSource: async (_url, include) => { seen.push(include); return input; } });
    await runCoachDbArchiveCommand(["--apply"], { COACH_DB_DATABASE_URL: "synthetic" }, () => { throw new Error("must stay closed"); }, { readSource: async (_url, include) => { seen.push(include); return input; } });
  });
  assert.deepEqual(seen, [false, true]);
  await assert.rejects(() => runWithDataRepositories({ coachDbArchive: repository }, () => runCoachDbArchiveCommand([], {}, () => {}, { readSource: async () => input })), /COACH_DB_ARCHIVE_FAILED/);
  await assert.rejects(() => runWithDataRepositories({ coachDbArchive: repository }, () => runCoachDbArchiveCommand([], { COACH_DB_DATABASE_URL: "synthetic" }, () => {}, { readSource: async () => { throw new Error("private-canary"); } })), error => error instanceof Error && error.message === "COACH_DB_ARCHIVE_FAILED");
});
