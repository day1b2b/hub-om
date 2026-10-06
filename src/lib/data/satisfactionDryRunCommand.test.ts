import assert from "node:assert/strict";
import test from "node:test";
import type { OperationSession } from "./operationTypes";
import { matchSatisfactionCsv, parseSatisfactionDryRunArgs, runSatisfactionDryRunCommand } from "./satisfactionDryRunCommand";

const csv = "record_id,courseId,client,course,date,instructor,n,overall,pos_pct\nrow-1,SYN-1,Synthetic company,Synthetic course,2099-01-02,Synthetic instructor,10,4.5,90\nrow-2,SYN-X,Synthetic company,Absent course,2099-01-02,Synthetic instructor,4,3.0,50\n";
const operation = { id: "row-operation", operationId: "SYNTHETIC-OP", companyName: "Synthetic company", courseName: "Synthetic course", courseId: "SYN-1", startDate: "2099-01-02", endDate: "2099-01-02", timeText: "09:00-10:00", coach: "", instructors: "Synthetic instructor" } as OperationSession;

test("satisfaction dry-run parses exact CLI arguments", () => {
  assert.deepEqual(parseSatisfactionDryRunArgs(["--csv=/tmp/synthetic.csv"]), { csvPath: "/tmp/synthetic.csv", limit: 200 });
  assert.deepEqual(parseSatisfactionDryRunArgs(["--limit=3", "--csv=x.csv"]), { csvPath: "x.csv", limit: 3 });
  for (const args of [[], ["--csv=x", "--csv=y"], ["--csv=x", "--limit=0"], ["--csv=x", "--backend=postgres"]]) assert.throws(() => parseSatisfactionDryRunArgs(args), /SATISFACTION_DRY_RUN_FAILED/);
});

test("satisfaction dry-run matches decrypted repository operations without writes", () => {
  const result = matchSatisfactionCsv(csv, [operation], 5);
  assert.deepEqual(result.stats, { total: 2, matched: 1, ambiguous: 0, unmatched: 1 });
  assert.equal(result.candidates, 1); assert.equal(result.results[0].operationId, operation.id); assert.equal(result.results[1].status, "unmatched");
});

test("satisfaction dry-run preserves legacy course-name matching even when CSV courseId is equal", () => {
  const source = "record_id,courseId,client,course,date,instructor,overall\nrow-1,SYN-1,Synthetic company,Completely different course,2099-01-02,Synthetic instructor,4.5\n";
  const result = matchSatisfactionCsv(source, [operation], 5);
  assert.equal(result.results[0].status, "unmatched");
});

test("satisfaction dry-run command uses scoped/default read repository and closes default", async () => {
  const previousUrl = process.env.DATABASE_URL, previousSource = process.env.OPERATION_DATA_SOURCE;
  process.env.DATABASE_URL = "postgresql://synthetic@127.0.0.1:1/synthetic"; delete process.env.OPERATION_DATA_SOURCE;
  let reads = 0, closes = 0, loads = 0;
  try {
    const result = await runSatisfactionDryRunCommand(["--csv=synthetic.csv"], () => { loads++; }, { readSource: async () => csv, getDefaultRepository: () => ({ listOperations: async () => { reads++; return [operation]; } } as never), closeDefaultRepository: async () => { closes++; } });
    assert.equal(result.stats.matched, 1); assert.equal(reads, 1); assert.equal(loads, 1); assert.equal(closes, 1);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousSource === undefined) delete process.env.OPERATION_DATA_SOURCE; else process.env.OPERATION_DATA_SOURCE = previousSource;
  }
});
