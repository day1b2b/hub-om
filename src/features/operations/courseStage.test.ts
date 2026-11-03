import assert from "node:assert/strict";
import test from "node:test";
import { resolveCourseStage } from "./courseStage";

const round = (operationId: string, startDate: string, endDate: string, instructors = "") => ({
  operationId, label: `${operationId}회차`, instructors, startDate, endDate
});

test("no instructor on any round is the assign stage", () => {
  assert.equal(resolveCourseStage([round("1", "2026-12-15", "2026-12-15")], new Set(), "2026-11-03").stage, "assign");
});

test("an assigned course that has not ended is the contract stage", () => {
  const result = resolveCourseStage([round("1", "2026-12-15", "2026-12-15", "김기호")], new Set(), "2026-11-03");
  assert.deepEqual(result, { stage: "contract", pendingSurveyLabels: [] });
});

test("a course whose every round ended is the review stage and lists ended rounds without survey", () => {
  const rounds = [round("1", "2026-10-01", "2026-10-01", "김기호"), round("2", "2026-10-08", "", "김기호")];
  const result = resolveCourseStage(rounds, new Set(["1"]), "2026-11-03");
  assert.deepEqual(result, { stage: "review", pendingSurveyLabels: ["2회차"] });
});

test("partly ended courses stay in contract stage but already show finished rounds as pending", () => {
  const rounds = [round("1", "2026-10-01", "2026-10-01", "김기호"), round("2", "2026-12-01", "2026-12-01", "김기호")];
  assert.deepEqual(resolveCourseStage(rounds, new Set(), "2026-11-03"), { stage: "contract", pendingSurveyLabels: ["1회차"] });
});

test("today itself is not ended, and rounds without dates never count as ended", () => {
  assert.equal(resolveCourseStage([round("1", "2026-11-03", "2026-11-03", "김")], new Set(), "2026-11-03").stage, "contract");
  assert.equal(resolveCourseStage([round("1", "", "", "김")], new Set(), "2026-11-03").stage, "contract");
  assert.equal(resolveCourseStage([], new Set(), "2026-11-03").stage, "assign");
});
