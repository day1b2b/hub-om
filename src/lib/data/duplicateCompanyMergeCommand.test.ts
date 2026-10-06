import assert from "node:assert/strict";
import test from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { parseDuplicateCompanyMergeArgs, runDuplicateCompanyMergeCommand } from "./duplicateCompanyMergeCommand";
import type { DuplicateCompanyMergeRepository } from "./duplicateCompanyMergeRepository";

test("duplicate company merge arguments require exact names and apply gates", () => {
  assert.deepEqual(parseDuplicateCompanyMergeArgs(["--source=Typo", "--target=Correct", "--dry-run"]), { sourceName: "Typo", targetName: "Correct", apply: false });
  assert.deepEqual(parseDuplicateCompanyMergeArgs(["--source=Typo", "--target=Correct", "--apply", "--backup-confirmed", "--maintenance-confirmed"]), { sourceName: "Typo", targetName: "Correct", apply: true });
  for (const args of [
    ["--source=Typo"], ["--source=Typo", "--target=Typo"], ["--source=Typo", "--source=Other", "--target=Correct"],
    ["--source=Typo", "--target=Correct", "--apply"], ["--source=Typo", "--target=Correct", "--dry-run", "--apply"],
  ]) assert.throws(() => parseDuplicateCompanyMergeArgs(args));
});

test("scoped command never loads default environment and redacts repository errors", async () => {
  let loaded = 0, calls = 0;
  const ok: DuplicateCompanyMergeRepository = { async merge(input) { calls++; assert.equal(input.apply, false); return { sourceId: "s", targetId: "t", courses: [], labels: [], remainingCourses: 0, reassignedCourses: 0, mergedCourses: 0, updatedSessions: 0, reassignedLabels: 0, discardedLabels: 0 }; } };
  await runWithDataRepositories({ duplicateCompanyMerge: ok }, () => runDuplicateCompanyMergeCommand(["--source=Typo", "--target=Correct"], () => { loaded++; }));
  assert.equal(calls, 1); assert.equal(loaded, 0);
  const bad: DuplicateCompanyMergeRepository = { async merge() { throw new Error("private company canary"); } };
  await assert.rejects(runWithDataRepositories({ duplicateCompanyMerge: bad }, () => runDuplicateCompanyMergeCommand(["--source=Typo", "--target=Correct"], () => {})), error => error instanceof Error && error.message === "DUPLICATE_COMPANY_MERGE_FAILED" && !error.message.includes("canary"));
});

test("default PostgreSQL command closes its owned client on success and failure", async () => {
  const result = { sourceId: "s", targetId: "t", courses: [], labels: [], remainingCourses: 0, reassignedCourses: 0, mergedCourses: 0, updatedSessions: 0, reassignedLabels: 0, discardedLabels: 0 };
  for (const failure of [null, "merge", "close"] as const) {
    let loaded = 0, closed = 0;
    const repository: DuplicateCompanyMergeRepository = { async merge() { if (failure === "merge") throw new Error("private"); return result; } };
    const run = runDuplicateCompanyMergeCommand(["--source=Typo", "--target=Correct"], () => { loaded++; }, { getDefaultRepository: () => repository, async closeDefaultRepository() { closed++; if (failure === "close") throw new Error("private"); } });
    if (failure) await assert.rejects(run, /^Error: DUPLICATE_COMPANY_MERGE_FAILED$/); else await run;
    assert.equal(loaded, 1); assert.equal(closed, 1);
  }
});
