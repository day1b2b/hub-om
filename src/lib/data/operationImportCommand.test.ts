import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeOperationImportDatabase, parseOperationImportArgs, parseOperationImportSource, runOperationImportCommand } from "./operationImportCommand";

test("operation import arguments default to dry-run and require apply confirmations", () => {
  assert.deepEqual(parseOperationImportArgs([], {}), { apply: false, file: ".local/operations.json" });
  assert.deepEqual(parseOperationImportArgs(["--file=fixture.json", "--apply", "--backup-confirmed", "--maintenance-confirmed"], {}), { apply: true, file: "fixture.json" });
  for (const args of [["--apply"], ["--dry-run", "--apply"], ["--unknown"], ["--file=a", "--file=b"]]) assert.throws(() => parseOperationImportArgs(args, {}), /OPERATION_IMPORT_FAILED/);
  assert.throws(() => assertSafeOperationImportDatabase("postgresql://fixture@db.invalid/test", undefined), /OPERATION_IMPORT_FAILED/);
});

test("operation import source preserves legacy normalization and rejects invalid dates", () => {
  const [value] = parseOperationImportSource(JSON.stringify([{ operationId: " OP  1 ", companyName: " Synthetic\n Company ", courseName: "", courseId: 2, startDate: "2099-01-01", endDate: "2099-01-02" }]));
  assert.equal(value.operationId, "OP 1"); assert.equal(value.companyName, "Synthetic Company"); assert.equal(value.courseName, "과정명 미확인"); assert.deepEqual(value.validationErrors, ["과정명 누락"]);
  assert.throws(() => parseOperationImportSource(JSON.stringify([{ operationId: "X", companyName: "C", courseName: "N", startDate: "2099-02-30", endDate: "2099-03-01" }])), /OPERATION_IMPORT_FAILED/);
});

test("operation import command reads once, returns counts and distinguishes cleanup failure", async () => {
  const prior = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1:5432/test"; let reads = 0;
  const dependencies = { readSource: async () => { reads++; return JSON.stringify([row]); }, getDefaultRepository: () => ({ async importOperations(entries: readonly unknown[], file: string, apply: boolean) { assert.equal(entries.length, 1); assert.equal(file, "synthetic.json"); assert.equal(apply, false); return { operations: 1, inserted: 1, updated: 0, sourceRecordsInserted: 1, sourceRecordsSkipped: 0 }; } }), closeDefaultRepository: async () => {} };
  try { const result = await runOperationImportCommand(["--file=synthetic.json"], process.env, () => {}, dependencies); assert.equal(result.result.inserted, 1); assert.equal(reads, 1);
    await assert.rejects(runOperationImportCommand(["--file=synthetic.json"], process.env, () => {}, { ...dependencies, closeDefaultRepository: async () => { throw new Error("private"); } }), /^Error: OPERATION_IMPORT_CLEANUP_FAILED$/);
  } finally { if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior; }
});
const row = { operationId: "OP-1", companyName: "Synthetic", courseName: "Course", courseId: "C", startDate: "2099-01-01", endDate: "2099-01-02" };
