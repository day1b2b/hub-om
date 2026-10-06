import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCoachArchiveServiceBackfillArgs, runCoachArchiveServiceBackfillCommand } from "./coachArchiveServiceBackfillCommand";
import { runWithDataRepositories } from "./dataRepositoryContext";

test("coach archive service backfill arguments default to dry-run and guard apply", () => {
  assert.deepEqual(parseCoachArchiveServiceBackfillArgs([]), { apply: false });
  assert.deepEqual(parseCoachArchiveServiceBackfillArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseCoachArchiveServiceBackfillArgs(["--apply", "--backup-confirmed", "--maintenance-confirmed"]), { apply: true });
  for (const args of [["--apply"], ["--dry-run", "--apply"], ["--unknown"]]) assert.throws(() => parseCoachArchiveServiceBackfillArgs(args));
});

test("scoped command never loads default environment and returns counts only", async () => {
  const summary = { coachRows: 2, changedCoaches: 1, accessLogRows: 3, updatedCoaches: 0, upsertedAccessLogs: 0 };
  const result = await runWithDataRepositories({ coachArchiveServiceBackfill: { async backfill(options) { assert.deepEqual(options, { apply: false }); return summary; } } },
    () => runCoachArchiveServiceBackfillCommand([], () => { throw new Error("environment must stay closed"); }));
  assert.deepEqual(result, { options: { apply: false }, summary });
});

test("command sanitizes repository failures", async () => {
  await assert.rejects(runWithDataRepositories({ coachArchiveServiceBackfill: { async backfill() { throw new Error("synthetic private archive value"); } } },
    () => runCoachArchiveServiceBackfillCommand([], () => {})), error => {
      assert.equal(String(error), "Error: COACH_ARCHIVE_SERVICE_BACKFILL_FAILED");
      assert.ok(!String(error).includes("private")); return true;
    });
});
