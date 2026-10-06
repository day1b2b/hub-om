import assert from "node:assert/strict";
import test from "node:test";
import { compareCoachVerificationCounts, type CoachDataVerificationReport } from "./coachDataVerificationRepository";
import { runCoachDataVerificationCommand } from "./coachDataVerificationCommand";
import { runWithDataRepositories } from "./dataRepositoryContext";

const report: CoachDataVerificationReport = { serviceCounts: [{ label: "coaches_total", count: 2 }, { label: "engagements", count: 1 },
  { label: "schedules", count: 0 }, { label: "engagement_schedules", count: 3 }], latestImport: null, latestArchive: null,
  archiveCounts: [{ label: "coaches", count: 2 }, { label: "engagements", count: 0 }, { label: "engagement_schedules", count: 4 }] };
test("coach data verification uses the scoped read-only repository", async () => {
  let reads = 0, loads = 0;
  const result = await runWithDataRepositories({ coachDataVerification: { readReport: async () => { reads++; return report; } } },
    () => runCoachDataVerificationCommand([], () => { loads++; }));
  assert.equal(reads, 1); assert.equal(loads, 0); assert.equal(result, report);
  assert.deepEqual(compareCoachVerificationCounts(report.archiveCounts, report.serviceCounts, true), [
    { archive: "coaches", service: "coaches_total", archive_count: 2, service_count: 2, diff: 0, ok: true },
    { archive: "engagements", service: "engagements", archive_count: 0, service_count: 1, diff: 1, ok: false },
    { archive: "coach_schedules", service: "schedules", archive_count: 0, service_count: 0, diff: 0, ok: true },
    { archive: "engagement_schedules", service: "engagement_schedules", archive_count: 4, service_count: 3, diff: -1, ok: false },
  ]);
  assert.deepEqual(compareCoachVerificationCounts([], report.serviceCounts, false), []);
  await assert.rejects(runCoachDataVerificationCommand(["extra"], () => {}), /COACH_DATA_VERIFICATION_FAILED/);
});
