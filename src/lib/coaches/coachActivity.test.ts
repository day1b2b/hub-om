import assert from "node:assert/strict";
import test from "node:test";
import {
  digestCoachEngagements,
  effectiveEngagementStatus,
  seoulTodayKey,
  shiftMonths,
  summarizeCoachActivity,
  type CoachActivityPolicy
} from "./coachActivity";

const policy: CoachActivityPolicy = { dormantMonths: 6, recentRatingWindow: 6, minRatingsForAverage: 3 };
const fact = (startDate: string, cancelled = false, endDate = startDate) => ({ startDate, endDate, cancelled });

test("activity status: never without past deploys, active within the window, dormant after it", () => {
  assert.equal(summarizeCoachActivity([], "2026-10-23", policy).status, "never");
  // 앞으로 잡힌 투입만 있으면 아직 미투입이다.
  const upcomingOnly = summarizeCoachActivity([fact("2026-11-02")], "2026-10-23", policy);
  assert.deepEqual(upcomingOnly, { status: "never", deployCount: 0, lastDeployDate: null, upcomingCount: 1 });
  // 기준일 당일 시작은 투입으로 센다.
  assert.equal(summarizeCoachActivity([fact("2026-10-23")], "2026-10-23", policy).status, "active");
  assert.equal(summarizeCoachActivity([fact("2026-04-23")], "2026-10-23", policy).status, "active");
  assert.equal(summarizeCoachActivity([fact("2026-04-22")], "2026-10-23", policy).status, "dormant");
});

test("dormancy follows the end date, so a long engagement still running stays active", () => {
  // 7개월 전에 시작해 아직 진행 중이면 활동이다. 최근 투입 칸은 시작일을 그대로 보여준다.
  const running = summarizeCoachActivity([fact("2026-03-01", false, "2026-12-31")], "2026-10-23", policy);
  assert.deepEqual(running, { status: "active", deployCount: 1, lastDeployDate: "2026-03-01", upcomingCount: 0 });
  // 일찍 시작했어도 기간 안에 끝났으면 활동, 끝난 지 기간이 지났으면 휴면이다.
  assert.equal(summarizeCoachActivity([fact("2026-01-05", false, "2026-05-01")], "2026-10-23", policy).status, "active");
  assert.equal(summarizeCoachActivity([fact("2026-01-05", false, "2026-04-22")], "2026-10-23", policy).status, "dormant");
});

test("activity ignores cancelled engagements and picks the latest start date", () => {
  const activity = summarizeCoachActivity(
    [fact("2026-10-01", true), fact("2026-03-01"), fact("2026-02-01"), fact("2026-12-01")],
    "2026-10-23",
    policy
  );
  assert.deepEqual(activity, { status: "dormant", deployCount: 2, lastDeployDate: "2026-03-01", upcomingCount: 1 });
});

test("recent average uses the latest rated engagements and hides small samples", () => {
  const row = (endDate: string, rating: number | null, cancelled = false) => ({ startDate: endDate, endDate, cancelled, rating });
  const two = digestCoachEngagements([row("2026-01-01", 5), row("2026-02-01", 3)], policy);
  assert.equal(two.recentAvgRating, null);
  assert.equal(two.recentRatingCount, 2);

  // 최근 6건만 본다. 가장 오래된 1점은 빠지고, 평가 없는 투입·취소 투입은 세지 않는다.
  const rows = [
    row("2025-01-01", 1),
    ...["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"].map((date) => row(date, 4)),
    row("2026-07-01", null),
    row("2026-08-01", 1, true)
  ];
  const digest = digestCoachEngagements(rows, policy);
  assert.equal(digest.recentAvgRating, 4);
  assert.equal(digest.recentRatingCount, 6);
  assert.equal(digest.engagementFacts[0].startDate, "2026-08-01");
  assert.equal(digest.engagementFacts[0].cancelled, true);
  assert.equal(digest.engagementFacts.length, rows.length);
});

test("engagement status follows dates except cancelled and completed", () => {
  const today = "2026-10-23";
  const at = (status: "scheduled" | "in_progress" | "completed" | "cancelled", startDate: string, endDate: string) =>
    effectiveEngagementStatus({ status, startDate, endDate }, today);
  assert.equal(at("scheduled", "2026-10-01", "2026-10-02"), "completed");
  assert.equal(at("scheduled", "2026-10-22", "2026-10-24"), "in_progress");
  assert.equal(at("in_progress", "2026-10-01", "2026-10-22"), "completed");
  assert.equal(at("scheduled", "2026-10-24", "2026-10-24"), "scheduled");
  assert.equal(at("cancelled", "2026-10-01", "2026-10-01"), "cancelled");
  assert.equal(at("completed", "2026-12-01", "2026-12-01"), "completed");
});

test("month shift clamps to the last day and today follows Asia/Seoul", () => {
  assert.equal(shiftMonths("2026-10-23", -6), "2026-04-23");
  assert.equal(shiftMonths("2026-08-31", -6), "2026-02-28");
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftMonths("2026-01-15", -1), "2025-12-15");
  // UTC 15:30은 서울 기준 다음 날 00:30이다.
  assert.equal(seoulTodayKey(new Date("2026-10-22T15:30:00.000Z")), "2026-10-23");
});
