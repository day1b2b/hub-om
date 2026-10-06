import assert from "node:assert/strict";
import test from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { runCoachOperationBackfillCommand, runCoachOperationDiagnoseCommand } from "./coachOperationMatchCommand";
import type { CoachOperationMatchRepository } from "./coachOperationMatchRepository";

const day = new Date("2099-06-01T00:00:00.000Z");
function fixture(): { repository: CoachOperationMatchRepository; applied: Array<{ engagementId: string; operationSessionId: string }> } {
  const applied: Array<{ engagementId: string; operationSessionId: string }> = [];
  return { applied, repository: {
    async readSnapshot() { return {
      counts: { total: 3, matched: 1, unmatched: 2 },
      candidates: [{ id: "op-1", operationId: "OP-1", companyName: "합성 회사", courseName: "합성 과정", startDate: "2099-06-01", endDate: "2099-06-01" }],
      engagements: [
        { id: "eng-1", courseName: "합성 과정", coachName: "합성 코치", startDate: day, endDate: day, startTime: null, endTime: null, scheduleDates: [], scheduleTimes: [] },
        { id: "eng-2", courseName: "다른 과정", coachName: null, startDate: day, endDate: day, startTime: null, endTime: null, scheduleDates: [], scheduleTimes: [] }
      ]
    }; },
    async applyMatches(matches) { applied.push(...matches); return matches.length; }
  } };
}

test("coach operation commands preserve dry-run, apply and diagnostic semantics", async () => {
  const dry = fixture(); let loaded = 0;
  const drySummary = await runWithDataRepositories({ coachOperationMatch: dry.repository }, () => runCoachOperationBackfillCommand([], () => { loaded++; }));
  assert.deepEqual(drySummary, { checked: 2, matched: 1, unmatched: 1, updated: 0, apply: false }); assert.deepEqual(dry.applied, []);
  const apply = fixture();
  const applySummary = await runWithDataRepositories({ coachOperationMatch: apply.repository }, () => runCoachOperationBackfillCommand(["--apply", "ignored"], () => { loaded++; }));
  assert.deepEqual(applySummary, { checked: 2, matched: 1, unmatched: 1, updated: 1, apply: true });
  assert.deepEqual(apply.applied, [{ engagementId: "eng-1", operationSessionId: "op-1" }]);
  const diagnostic = await runWithDataRepositories({ coachOperationMatch: apply.repository }, () => runCoachOperationDiagnoseCommand(["--limit=1"], () => { loaded++; }));
  assert.deepEqual(diagnostic.counts, { total: 3, matched: 1, unmatched: 2 }); assert.equal(diagnostic.limit, 1); assert.equal(diagnostic.rows.length, 1);
  assert.deepEqual(diagnostic.topCourseNames, [{ courseName: "합성 과정", count: 1 }, { courseName: "다른 과정", count: 1 }]);
  assert.equal(diagnostic.rows[0].bestOperation, "OP-1"); assert.equal(loaded, 0);
});

test("coach operation commands redact repository failures", async () => {
  const repository = { async readSnapshot() { throw new Error("private-canary"); }, async applyMatches() { return 0; } };
  await assert.rejects(runWithDataRepositories({ coachOperationMatch: repository }, () => runCoachOperationBackfillCommand([], () => {})), error => error instanceof Error && error.message === "COACH_OPERATION_MATCH_FAILED" && !error.message.includes("canary"));
});

test("coach operation commands redact default client close failures", async () => {
  const f = fixture(); let closed = 0;
  const dependencies = { getDefaultRepository: () => f.repository, async closeDefaultRepository() { closed++; throw new Error("private-close-canary"); } };
  await assert.rejects(runCoachOperationBackfillCommand([], () => {}, dependencies), error => error instanceof Error && error.message === "COACH_OPERATION_MATCH_FAILED" && !error.message.includes("canary"));
  await assert.rejects(runCoachOperationDiagnoseCommand([], () => {}, dependencies), error => error instanceof Error && error.message === "COACH_OPERATION_MATCH_FAILED" && !error.message.includes("canary"));
  assert.equal(closed, 2);
});
